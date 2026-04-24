import { initialize_filters } from './filter-manager.js';
import { initialize_results } from './result-manager.js';

//Perform initial parsing of query parameters and process the request accordingly
async function parse_request() {
  const params = new URLSearchParams(window.location.search);

  if (params.has('view')) {
    //Render a specific view if requested
    await render_view(params.get('view'));
  }
  else {
    //Otherwise render the index
    await render_index();
  }
}

//Generate the content for the "landing page" view, with the list of all registered view links
async function render_index() {
  //Get the view definition file first
  const view = await get('views/index.json', true);

  //Redirect to the only available view if only one is defined
  if (view.contents.length == 1) {
    const url = new URL(window.location.href);
    url.searchParams.set('view', view.contents[0].view.replace(/\.json$/, ""));
    window.location.href = url.toString();
  }

  //Load all templates and CSS files
  await load_templates_and_css(view);

  //Create and populate a list with links to all views
  const ul = document.createElement('ul');
  view.contents.forEach((entry) => {
    const view_name = entry.view.replace(/\.json$/, "");
    const li = document.createElement('li');
    li.innerHTML = `<a href="?view=${view_name}">${entry.link_label}</a>`;
    ul.appendChild(li);
  });

  //Append the list to the corresponding container
  document.getElementById('smwce_index_container').append(ul);
}

//Generate the content for a specific topic view
async function render_view(view_name) {
  //Get the view definition file first
  const view = await get(`views/${view_name}.json`, true);

  //Make sure required properties are defined for the view
  for (const property of ['template', 'api', 'search_conditions']) {
    if (!(property in view)) {
      throw new Error(`Missing view property: ${property}`);
    }
  }

  //Fetch the page data and allowed semantic property values while also loading all templates and
  //CSS files - all in parallel
  const [page_data, allowed_values] = await Promise.all([
    get_page_data(view),
    get_allowed_values(view),
    load_templates_and_css(view),
  ]);

  //Gather all filter values from allowed values and page data
  const filter_values = gather_filter_values(view.user_filters, allowed_values, page_data);

  //Populate all designated labels with their contents
  for (const [id, html] of Object.entries(view.labels)) {
    document.getElementById(id).innerHTML = html;
  }

  //Initialize the user filter container
  initialize_filters(document.getElementById('smwce_user_filter_area'), view.user_filters,
                     filter_values);

  //Initialize the results container
  initialize_results(document.getElementById('smwce_results_area'), view.printouts,
                     view.user_filters, page_data);
}

//Load all HTML template fragments and CSS files for a given view
async function load_templates_and_css(view) {
  //The template and CSS files can be specified as single filename strings or as arrays of multiple
  //filenamme strings - Make sure they're always arrays, creating a single element array if needed
  const template_files = Array.isArray(view.template)? view.template: [view.template];
  const css_files = 'css' in view? (Array.isArray(view.css)? view.css: [view.css]): [];

  //Map the template and CSS files to their corresponding subdirectories
  const template_urls = template_files.map(t => `templates/${t}`);
  const css_urls = css_files.map(s => `css/${s}`);

  //Apply all CSS files to the document now, so they download in the background
  css_urls.forEach(s => document.head.insertAdjacentHTML('beforeend',
                                                         `<link rel="stylesheet" href="${s}">`));

  //Fetch all template files in parallel and wait for them
  const templates = await Promise.all(template_urls.map(url => get(url)));

  //Append the templates to the document in the same order as they were defined
  templates.forEach(t => document.body.insertAdjacentHTML('beforeend', t));
}

//Request pages from the wiki based on the semantic properties defined in a view
async function get_page_data(view) {
  //Gather all distinct semantic properties in the user filters and printouts
  const printouts = [...new Set([
    ...Object.keys(view.user_filters ?? {}),
    ...Object.keys(view.printouts ?? {}),
  ])];

  //Format the query string by appending the printouts preceded by "|?" to the search conditions
  const query = view.search_conditions + printouts.map(p => `|?${p}`).join('');

  //Create a new URL with the required parameters
  const url = new URL(view.api);
  url.search = new URLSearchParams({
    action: 'ask',
    query: query,
    format: 'json',
    origin: '*',
  });

  //Perform the request and retrieve the data
  return await get(url, true);
}

//Perform an API request to obtain the allowed values of semantic properties, so that they can be
//shown for user filters that are configured to show every allowed value
async function get_allowed_values(view) {
  //Gather semantic property names for filters with "show_every_allowed_value" set to true
  const property_names = Object.entries(view.user_filters ?? {})
                         .filter(([prop_name, prop_info]) => prop_info.show_every_allowed_value)
                         .map(([prop_name, prop_info]) => prop_name);

  //Return immediately if there's no semantic properties configured to show every allowed value
  if (property_names.length == 0) return {};

  //Format all semantic property names in the form "Property:<name>", then join them using double
  //pipes to form OR conditions
  const conditions = '\x1F' + property_names.map(name => `Property:${name}`).join('||');
  //Note: The character U+001F (Unit Separator) is used so that pipes are not interpreted as value
  //separators, this way OR conditions can be expressed by double pipes.

  //Request the "Allows value" special property, which lists every allowed value
  const printouts = [
    'Allows value'
  ].join('|');

  //Create a new URL with the required parameters
  const url = new URL(view.api);
  url.search = new URLSearchParams({
    action: 'askargs',
    conditions: conditions,
    printouts: printouts,
    format: 'json',
    origin: '*',
  }).toString();

  //Perform the request and retrieve the data
  const response = await get(url, true);

  //Remap the response data to an object that contains the semantic property names as keys and the
  //array of allowed values as values
  return Object.fromEntries(property_names.map(prop_name =>
    [prop_name, response.query.results[`Property:${prop_name}`]['printouts']['Allows value']]
  ));
}

//Perform a HTTP request and obtain the response data
async function get(url, as_json = false) {
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`HTTP error! status: ${response.status}`);

  //Parse as JSON and return an object if requested, otherwise return as text
  return await as_json? response.json(): response.text();
}

//Gather all semantic property values that will be used by all filters
function gather_filter_values(user_filters, allowed_values, page_data) {
  //Unwrap all printout values from all query results as an array of arrays, as only the values are
  //of interest here regardless of what page they appear on
  const printouts = Object.values(page_data.query.results).map(r => r.printouts);

  //Iterate through each semantic property defined in the user filters to gather the filter values
  const filter_values = {};
  for (const prop_name in (user_filters ?? {})) {
    //If the semantic property is listed in the allowed values take them directly from there,
    //otherwise gather all unique values from the page data
    if (prop_name in allowed_values) {
      filter_values[prop_name] = allowed_values[prop_name];
    }
    else {
      //Obtain the type of the semantic property
      const typeid = page_data.query.printrequests.filter(pr => pr.label == prop_name)[0].typeid;

      //Individual values might appear multiple times in different pages, so use a set to filter
      //unique values
      const values = new Set();

      //Page data is formatted differently for each property type, so gather values accordingly
      switch (typeid) {
        case '_wpg':
          printouts.forEach(po => po[prop_name].forEach(v => values.add(v.fulltext)));
          break;
        case '_txt':
        case '_keyw':
          printouts.forEach(po => po[prop_name].forEach(v => values.add(v)));
          break;
        default:
          throw new Error(`Unrecognized type for property "${prop_name}": "${typeid}"`);
          break;
      }

      //Store the gathered values as a sorted array
      filter_values[prop_name] = [...values].sort();
    }
  }

  return filter_values;
}

//Perform global error handling while attempting to parse the request
try {
  await parse_request();
}
catch (err) {
  document.body.innerHTML = err.message;
}
