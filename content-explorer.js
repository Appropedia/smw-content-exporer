import { initialize_filters } from './filter-manager.js';
import { initialize_results } from './result-manager.js';

const api = 'https://www.appropedia.org/w/api.php';

//Perform initial parsing of query parameters and process the request accordingly
async function parse_request() {
  const views = await get_json('views.json');
  const params = new URLSearchParams(window.location.search);

  //Render the topic list if no specific topic is requested
  if (!params.has('topic')) {
    render_all_topics(views);
    return;
  }

  //Attempt to render a specific topic if requested
  const topic = params.get('topic');

  if (topic in views) {
    await render_topic(topic, views[topic]);
  }
  else {
    document.body.innerHTML = `Unknown topic: ${topic}`;
  }
}

//Generate the content for the "landing page" view, with the list of all registered topic links
function render_all_topics(views) {
  //Set the content heading
  document.body.innerHTML =
    '<h1>Content explorer</h1>' +
    '<p>Topics:</p>';

  //Create and populate a list with links to all topics
  const ul = document.createElement('ul');
  Object.keys(views).forEach((title) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="?topic=${title}">${title}</a>`;
    ul.appendChild(li);
  });

  document.body.append(ul);
}

//Generate the content for a specific topic view
async function render_topic(topic, view) {
  //Make sure required properties are defined for the view
  if (!('static_filters' in view)) {
    throw new Error('No static filters defined for this view');
  }

  if (!('user_filters' in view)) {
    throw new Error('No user filters defined for this view');
  }

  //Load all SMW properties
  const properties = await get_json('smw-properties.json');

  //Fetch the page data
  const page_data = await get_pages(view);

  //Create the top level div element
  const panel_container = document.createElement('div');
  panel_container.className = 'panel_container';

  //Create the left panel, which will contain the filters
  const left_panel = document.createElement('div');
  left_panel.className = 'left_panel';
  panel_container.appendChild(left_panel);

  //Create the right panel, which will contain the filtered query results
  const right_panel = document.createElement('div');
  right_panel.className = 'right_panel';
  panel_container.appendChild(right_panel);

  //Set the body contents
  document.body.innerHTML = `<h1>${topic}</h1>`;
  document.body.append(panel_container);

  //Initialize panel contents
  initialize_filters(left_panel, view.user_filters, properties, page_data);
  initialize_results(right_panel, view.printouts, view.user_filters, properties, page_data);
}

//Download and parse a JSON file
async function get_json(url) {
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`HTTP error! status: ${response.status}`);

  return await response.json();
}

//Request pages from the wiki based on the semantic properties defined in a view
async function get_pages(view) {
  //Format all namespaces and SMW properties in the static filters as an array of strings in the
  //form name:value and name::value respectively, then join them using pipes
  const conditions = [
    ...Object.entries(view.static_filters.namespaces ?? {}).map(([k, v]) => `${k}:${v}`),
    ...Object.entries(view.static_filters.properties ?? {}).map(([k, v]) => `${k}::${v}`),
  ].join('|');

  //Gather all distinct SMW properties in the user filters and printouts, then join them using pipes
  const printouts = [...new Set([
    ...Object.keys(view.user_filters.properties ?? {}),
    ...Object.keys((view.printouts ?? {}).properties ?? {}),
  ])].join('|');

  //Create a new URL with the required parameters
  const url = new URL(api);
  url.search = new URLSearchParams({
    action: 'askargs',
    conditions: conditions,
    printouts: printouts,
    format: 'json',
    origin: '*',
  }).toString();

  //Perform the request and retrieve the data
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`HTTP error! status: ${response.status}`);

  return await response.json();
}

//Perform global error handling while attempting to parse the request
try {
  await parse_request();
}
catch (err) {
  document.body.innerHTML = err.message;
}
