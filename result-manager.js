import { verify_property } from './common.js';

const result_set = [];

//Process the page data and present it inside a given HTML element
export function initialize_results(parent_element, printouts, user_filters, properties, page_data) {
  //Iterate through the query results
  for (const [page_title,  page_properties] of Object.entries(page_data.query.results)) {
    //Create a new div container for each result
    const result_container = document.createElement('div');
    result_container.className = 'result_container';

    //Add the page title
    const page_title_div = document.createElement('div');
    page_title_div.className = 'page_title';
    page_title_div.innerHTML = `<a href="${page_properties.fullurl}">${page_title}</a>`;
    result_container.appendChild(page_title_div);

    //Iterate through the printout properties
    for (const [smw_prop_name, smw_prop_info] of
         Object.entries((printouts ?? {}).properties ?? {}))
    {
      //Make sure the printout property is defined correctly
      verify_property(smw_prop_name, 'printout', properties);

      const printout_values = page_properties.printouts[smw_prop_name];

      //Create a div container for the printout property
      const page_property = document.createElement('div');
      page_property.className = 'page_property';

      //Process the printout according to the property type
      switch (properties[smw_prop_name].type) {
        case 'Text':
          page_property.textContent = `${smw_prop_name}: ${printout_values.join(', ')}`;
          break;
        case 'Page':
          page_property.innerHTML = `${smw_prop_name}: ` + printout_values.map(page => {
            const label = smw_prop_info.first_word_labels?
                          page.fulltext.split(' ')[0]:
                          page.fulltext;
            return `<a href="${page.fullurl}">${label}</a>`;
          }).join(', ');
          break;
        default:
          throw new Error(`Unrecognized/unimplemented type "${properties[smw_prop_name].type}" ` +
                          `defined for property "${smw_prop_name}"`);
          break;
      }

      result_container.appendChild(page_property);
    }

    //Create a new member for the result set
    const result_member = {
      element: result_container,
      properties: {},
    };
    result_set.push(result_member);

    //Iterate through the user filter properties
    for (const smw_prop_name in user_filters.properties) {
      //Make sure the user filter property is defined correctly
      verify_property(smw_prop_name, 'user filter', properties);

      const printout_values = page_properties.printouts[smw_prop_name];

      //Register filterable values according to the property type
      switch (properties[smw_prop_name].type) {
        case 'Text':
        case 'Keyword':
          result_member.properties[smw_prop_name] = printout_values;
          break;
        case 'Page':
          result_member.properties[smw_prop_name] = printout_values.map(page => page.fulltext);
          break;
        default:
          throw new Error(`Unrecognized/unimplemented type "${properties[smw_prop_name].type}" ` +
                          `defined for property "${smw_prop_name}"`);
          break;
      }
    }

    parent_element.appendChild(result_container);
  }
}

//Update the web page by applying all active filters to the result set
export function filter_results(filter_state) {
  //Start with a full set of filtered results
  let filtered_result_set = [...result_set];

  //Iterate through every property in the filter state
  for (const [smw_prop_name, filters_by_value] of Object.entries(filter_state)) {
    //Iterate through every property value as well
    for (const [smw_prop_value, filter] of Object.entries(filters_by_value)) {
      //Check if the filter is active
      if (filter.active) {
        //Filter the results by excluding those that don't include the property value
        filtered_result_set = filtered_result_set.filter(result => {
          if (!result.properties[smw_prop_name].includes(smw_prop_value)) {
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
