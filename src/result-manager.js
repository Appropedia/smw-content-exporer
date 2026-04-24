//Stores information about page results, such as property values and HTML elements linked to them
const all_results = [];

//Process the page data and present it inside a given HTML element
export function initialize_results(parent_element, printouts, user_filters, page_data) {
  //Iterate through the query results
  for (const [page_title,  page_properties] of Object.entries(page_data.query.results)) {
    //Create a new div container for each result
    const result_container = document.createElement('div');
    result_container.className = 'smwce_result_container';

    //Add the page title
    const page_title_div = document.createElement('div');
    page_title_div.className = 'smwce_page_title';
    page_title_div.innerHTML = `<a href="${page_properties.fullurl}">${page_title}</a>`;
    result_container.appendChild(page_title_div);

    //Iterate through the printout properties
    for (const [prop_name, prop_info] of Object.entries(printouts ?? {})) {
      //Obtain the printout values and type informaton of the property
      const printout_values = page_properties.printouts[prop_name];
      const type_info = page_data.query.printrequests.filter(pr => pr.label == prop_name)[0];

      //Create a div container for the printout property
      const page_property = document.createElement('div');
      page_property.className = 'smwce_page_property';

      //Process the printout according to the property type
      switch (type_info.typeid) {
        case '_txt':
        case '_keyw':
          page_property.textContent = `${prop_name}: ${printout_values.join(', ')}`;
          break;
        case '_wpg':
          page_property.innerHTML = `${prop_name}: ` + printout_values.map(page => {
            //If the property has mode 0 (meaning it's a category) then remove the 'Category:'
            //prefix from the full text, if only the first word is required then trim the full text
            //to just the first word, otherwise use the full text as is
            const label = type_info.mode == 0? page.fulltext.replace(/Category:/, ''):
                          prop_info.first_word_labels? page.fulltext.split(' ')[0]:
                          page.fulltext;

            return `<a href="${page.fullurl}">${label}</a>`;
          }).join(', ');
          break;
        default:
          throw new Error(`Unrecognized type for property "${prop_name}": "${type_info.typeid}"`);
          break;
      }

      result_container.appendChild(page_property);
    }

    //Create a new item for the results array
    const result_item = {
      element: result_container,
      properties: {},
    };
    all_results.push(result_item);

    //Iterate through the user filter properties
    for (const prop_name in user_filters) {
      //Obtain the printout values and type informaton of the property
      const printout_values = page_properties.printouts[prop_name];
      const type_info = page_data.query.printrequests.filter(pr => pr.label == prop_name)[0];

      //Register filterable values according to the property type
      switch (type_info.typeid) {
        case '_txt':
        case '_keyw':
          result_item.properties[prop_name] = printout_values;
          break;
        case '_wpg':
          result_item.properties[prop_name] = printout_values.map(page => page.fulltext);
          break;
        default:
          throw new Error(`Unrecognized type for property "${prop_name}": "${type_info.typeid}"`);
          break;
      }
    }

    parent_element.appendChild(result_container);
  }
}

//Update the web page by applying all active filters to the result set
export function filter_results(filter_state) {
  //Start with a full set of filtered results by creating a copy
  let filtered_result_set = [...all_results];

  //Iterate through every property in the filter state
  for (const [prop_name, filters_by_value] of Object.entries(filter_state)) {
    //Iterate through every property value as well
    for (const [prop_value, filter] of Object.entries(filters_by_value)) {
      //Check if the filter is active
      if (filter.active) {
        //Filter the results by excluding those that don't include the property value
        filtered_result_set = filtered_result_set.filter(result => {
          if (!result.properties[prop_name].includes(prop_value)) {
            result.element.hidden = true;
            return false;
          }
          return true;
        });
      }
    }
  }

  //Iterate through the remaining results and show them
  for (const result of filtered_result_set) {
    result.element.hidden = false;
  }
}
