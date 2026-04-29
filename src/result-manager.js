//Stores information about page results, such as property values and HTML elements linked to them
const all_results = [];

//Process the page data and present it inside a given HTML element
export function initialize_results(parent_element, printouts, user_filters, page_data) {
  //Iterate through the query results
  for (const [page_title,  page_properties] of Object.entries(page_data.query.results)) {
    //Create a new div container for each result
    const result_container = document.createElement('div');
    result_container.className = 'smwce_result_container';
    result_container.hidden = true;

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

//Check whether the given semantic property values of a page satisfy the given filter values
function check_values(value_merge_op, filter_values, property_values) {
  switch (value_merge_op) {
    case 'conjunction':
      return filter_values.every(prop_value => property_values.includes(prop_value));
    case 'disjunction':
      return filter_values.some(prop_value => property_values.includes(prop_value));
  }
}

//Check whether the given semantic properties of a page satisfy the given filter conditions
function check_filters(filter_merge_op, filters, page_properties) {
  switch (filter_merge_op) {
    case 'conjunction':
      return Object.keys(filters).every(prop_name => check_values(filters[prop_name].value_merge_op,
                                                                  filters[prop_name].values,
                                                                  page_properties[prop_name]));
    case 'disjunction':
      return Object.keys(filters).some(prop_name => check_values(filters[prop_name].value_merge_op,
                                                                 filters[prop_name].values,
                                                                 page_properties[prop_name]));
  }
}

//Update the web page by applying all active filters to the result set
export function filter_results(filter_state, filter_merge_op) {
  //Create an array of objects that contains the names, value merge operations and values of all
  //properties with active filters
  const active_filters = {};
  for (const [prop_name, fs_item] of Object.entries(filter_state)) {
    active_filters[prop_name] = {
      value_merge_op: fs_item.value_merge_op,
      values: Object.keys(fs_item.values).filter(prop_value => fs_item.values[prop_value].active),
    };
  }

  //Filter all result pages by hiding/revealing them based on active filter conditions
  for (const page of all_results) {
    page.element.hidden = !check_filters(filter_merge_op, active_filters, page.properties);
  };
}
