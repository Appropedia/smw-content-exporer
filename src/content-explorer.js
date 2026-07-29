import { get, collect_globals } from './data-collection.js';
import { evaluate_templates } from './template-evaluator.js';
import { initialize_window_functions } from './window-functions.js';

//Perform initial parsing of query parameters and process the request accordingly
async function parse_request() {
  const params = new URLSearchParams(window.location.search);

  //Render a specific view if requested, otherwise render the index
  const view = params.get('view') ?? 'index';

  //Make sure the view name contains valid characters only (protect the user from path traversal
  //attacks in malicious links)
  if (!/^[a-zA-Z\-_]+$/.test(view)) {
    throw new Error('The view name has invalid characters');
  }

  await render_view(`views/${view}.json`);
}

//Generate the content for a specific view
async function render_view(view_url) {
  //Get the view definition file first
  const view = await get(view_url, true);

  //Apply all CSS files to the document now, so they download in the background
  document.head.insertAdjacentHTML('beforeend', generate_css_tags(view));

  //Perform all operations involving data downloads in parallel
  const [ { templates, root_template }, globals ] = await Promise.all([
    get_templates(view),    //Download all template fragments
    collect_globals(view),  //Construct the global namespace (may involve external data queries)
  ]);

  //Evaluate and render the templates
  const body_contents = evaluate_templates(templates, root_template, globals);
  document.body.appendChild(body_contents);

  //Initialize the filters
  initialize_window_functions(view);
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

//Parse the request to start the process
await parse_request();
