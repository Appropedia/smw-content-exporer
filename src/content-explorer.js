import * as builtins from './builtins.js';
import { evaluate_templates } from './template-evaluator.js';
import { initialize_filter_functions } from './filter-functions.js';

//Perform initial parsing of query parameters and process the request accordingly
async function parse_request() {
  const params = new URLSearchParams(window.location.search);

  //Render a specific view if requested, otherwise render the index
  await render_view(params.get('view') ?? 'index.json');
}

//Generate the content for a specific view
async function render_view(view_name) {
  //Get the view definition file first
  const view = await get(`views/${view_name}`, true);

  //Apply all CSS files to the document now, so they download in the background
  document.head.insertAdjacentHTML('beforeend', generate_css_tags(view));

  //Download all templates, page data and allowed values in parallel
  const [{ templates, root_template }, page_data, allowed_values] = await Promise.all([
    get_templates(view),
    get_page_data(view),
    get_allowed_values(view),
  ]);

  //Gather all filter values from allowed values and page data
  const filter_values = gather_filter_values(view.filters, allowed_values, page_data);

  //Construct the global namespace
  //Note: member order is intentional, as there's the possibility of shadowing
  const globals = {
    ...builtins,
    ...Object.keys(page_data).length > 0? {
      results: (page_data.query ?? {}).results ?? [],
    }: {},
    ...Object.keys(filter_values).length > 0? {
      filter_properties: filter_values,
    }: {},
    ...view.parameters,
  };

  //Evaluate and render the templates
  const body_contents = evaluate_templates(templates, root_template, globals);
  document.body.appendChild(body_contents);

  //Initialize the filters
  initialize_filter_functions(view, page_data);
}

//Generate all CSS tags for a given view
function generate_css_tags(view) {
  if (!Object.hasOwn(view, 'css')) return '';  //Return immediately if no CSS files are specified

  //The css field can be specified as a single string or as an array of strings - Make sure it's
  //always an array, creating a single element array if needed
  const css_files = Array.isArray(view.css)? view.css: [view.css];

  //Map the CSS files to their corresponding subdirectory
  const css_urls = css_files.map(s => `css/${s}`);

  //Generate, join and return all CSS tags
  return css_urls.map(u => `<link rel="stylesheet" href="${u}">`).join('');
}

//Download all HTML template fragments for a given view
async function get_templates(view) {
  //Make sure templates are defined in the view
  if (!Object.hasOwn(view, 'template')) {
    throw new Error('Missing view property: template');
  }

  //The template field can be specified as a single string or as an array of strings - Make sure
  //it's always an array, creating a single element array if needed
  const template_files = Array.isArray(view.template)? view.template: [view.template];

  //Map the template files to their corresponding subdirectory
  const template_urls = template_files.map(t => `templates/${t}`);

  //Fetch all template files in parallel and wait for them
  const templates = await Promise.all(template_urls.map(url => get(url)));

  //Return all loaded files as a single object
  return {
    root_template: template_files[0],
    templates: Object.fromEntries(template_files.map(
      (file, index) => [file, { text: templates[index] }])),
  };
}

//Request pages from the wiki based on the semantic properties defined in a view
async function get_page_data(view) {
  //Don't attempt to retrieve data if no API url or search conditions are defined
  if (!Object.hasOwn(view, 'api') || !Object.hasOwn(view, 'search_conditions')) return {};

  //Gather all distinct semantic properties in the filters and printouts
  const printouts = [...new Set([
    ...Object.keys(view.filters ?? {}),
    ...view.printouts ?? [],
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
//shown for filters that are configured to show every allowed value
async function get_allowed_values(view) {
  //Gather semantic property names for filters with "show_every_allowed_value" set to true
  const property_names = Object.entries(view.filters ?? {})
                         .filter(([_prop_name, prop_info]) => prop_info.show_every_allowed_value)
                         .map(([prop_name, _prop_info]) => prop_name);

  //Return immediately if there's no semantic properties configured to show every allowed value
  if (property_names.length === 0) return {};

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
function gather_filter_values(filters, allowed_values, page_data) {
  //Return immediately if there's no page data
  if (!Object.hasOwn(page_data, 'query')) return {};

  //Unwrap all printout values from all query results as an array of arrays, as only the values are
  //of interest here regardless of what page they appear on
  const printouts = Object.values(page_data.query.results).map(r => r.printouts);

  //Iterate through each semantic property defined in the filters to gather the filter values
  const filter_values = {};
  for (const prop_name in (filters ?? {})) {
    //If the semantic property is listed in the allowed values take them directly from there,
    //otherwise gather all unique values from the page data
    if (Object.hasOwn(allowed_values, prop_name)) {
      filter_values[prop_name] = allowed_values[prop_name];
    }
    else {
      //Obtain the type of the semantic property
      const typeid = page_data.query.printrequests.filter(pr => pr.label === prop_name)[0].typeid;

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
      }

      //Store the gathered values as a sorted array
      filter_values[prop_name] = [...values].sort();
    }
  }

  return filter_values;
}

//Parse the request to start the process
await parse_request();
