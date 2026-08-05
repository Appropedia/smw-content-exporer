import * as builtins from './builtins.js';

//Perform an HTTP request and obtain the response data
export async function get(url, as_json = false) {
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`HTTP error! status: ${response.status}`);

  //Parse as JSON and return an object if requested, otherwise return as text
  return await as_json? response.json(): response.text();
}

//Concurrently gather all values specified in a view definition from internal and external sources
export async function collect_globals(view) {
  const globals = { ...builtins };
  const json_requests = new Map();
  const search_requests = new Map();
  const printout_value_sets = {};

  //Iterate through the global values in the view definition
  for (const [name, descriptor] of Object.entries(view.globals ?? {})) {
    if (Object.hasOwn(descriptor, 'value')) {
      //The global value is defined directly, use it as is
      globals[name] = descriptor.value;
    }
    else if (Object.hasOwn(descriptor, 'json_file')) {
      //The global value is defined in a JSON file, download and use that file
      json_requests.set(name, get(descriptor.json_file, true));
    }
    else if (Object.hasOwn(descriptor, 'semantic_search')) {
      //The global value describes a semantic search; add it to the search requests
      search_requests.set(name, semantic_search(descriptor, view.api));
    }
    else if (Object.hasOwn(descriptor, 'printout_value_set')) {
      //The global value describes a printout value set; record the refefenced global for later
      printout_value_sets[name] = descriptor;
    }
  }

  //JSON file and search requests are being performed in parallel in the background at this point;
  //wait for all of them
  const [json_data, search_results] = await Promise.all([
    Promise.all(json_requests.values()),
    Promise.all(search_requests.values()),
  ]);

  //Consolidate all JSON file data into the global namespace
  json_requests.keys().forEach((name, index) => {
    globals[name] = json_data[index];
  });

  //Consolidate all search results into the global namespace while also keeping a reference to the
  //print request metadata
  const print_requests = {};
  search_requests.keys().forEach((name, index) => {
    globals[name] = search_results[index][0];
    print_requests[name] = search_results[index][1];
  });

  //Now collect any pending printout value sets
  for (const [name, descriptor] of Object.entries(printout_value_sets)) {
    const reference = descriptor.printout_value_set;
    const printouts = [].concat(descriptor.printouts ?? []);

    if (!Object.hasOwn(globals, reference)) {
      throw new Error(`"${reference}" is not a global value`);
    }

    globals[name] = collect_printout_set(globals[reference], print_requests[reference], printouts);
  }

  return globals;
}

//Request pages from the wiki based on the provided semantic search conditions
async function semantic_search(descriptor, api) {
  if (api === undefined) {
    throw new Error('No API configuration provided for semantic page search');
  }

  //The descriptor members below can be either arrays of strings of standalone strings; make sure
  //they're always expressed as arrays of strings
  const printouts = [].concat(descriptor.printouts ?? []);
  const parameters = [].concat(descriptor.parameters ?? []);

  //Format the query string by appending the printouts and parameters to the search conditions by
  //separating them with "|?" and "|" respectively
  const query = descriptor.semantic_search +
                printouts.reduce((acc, p) => acc + `|?${p}`, '') +
                parameters.reduce((acc, p) => acc + `|${p}`, '');

  //Create a new URL with the query parameters
  const url = new URL(api);
  url.search = new URLSearchParams({
    action: 'ask',
    query: query,
    format: 'json',
    origin: '*',
  });

  //Perform paginated requests until all results are retrieved
  let response;
  const results = {};
  do {
    //Obtain the query continue offset parameter from last request, if available
    const offset = response?.['query-continue-offset'];

    //Add the offset value to the query parameter for the next request, if needed
    if (offset !== undefined) {
      url.searchParams.set('query', query + `|offset=${offset}`);
    }

    //Request the next block
    response = await get(url, true);

    //Accumulate the results
    Object.assign(results, response.query.results);
  } while (Object.hasOwn(response, 'query-continue-offset'));

  //Take the print request metadata from the last response (every response has the same data)
  const print_requests = response.query.printrequests;

  return [results, print_requests];
}

//Collect the printout value set from a semantic search result
function collect_printout_set(search_results, print_requests, printouts) {
  //Iterate through the requested properties
  const results = {};
  for (const prop_name of printouts) {
    //Process the printouts according to the property type
    const type_id = print_requests.filter(pr => pr.label === prop_name)[0].typeid;
    switch (type_id) {
      case '_keyw': {
        //The property is a plaintext string; iterate through the search results and use a set to
        //collect it directly
        const value_set = new Set();
        for (const result_info of Object.values(search_results)) {
          //Skip properties that are not present
          if (!Object.hasOwn(result_info.printouts, prop_name)) {
            continue;
          }

          result_info.printouts[prop_name].forEach(p => value_set.add(p));
        }

        results[prop_name] = Array.from(value_set).sort();
        break;
      }
      case '_wpg': {
        //The property is a webpage object; iterate through the search results and use a set to
        //uniquely identify the full URLs while using an array to collect the complete objects
        const fullurl_set = new Set();
        const unique_webpages = [];
        for (const result_info of Object.values(search_results)) {
          for (const value of result_info.printouts[prop_name]) {
            if (!fullurl_set.has(value.fullurl)) {
              fullurl_set.add(value.fullurl);
              unique_webpages.push(value);
            }
          }
        }

        results[prop_name] = unique_webpages.sort((a, b) => a.fullurl.localeCompare(b.fullurl));
        break;
      }
      default: {
        throw new Error(`Unrecognized type for property "${prop_name}": "${type_id}"`);
      }
    }
  }

  return results;
}
