import { filter_results } from './result-manager.js';
import { verify_property } from './common.js';

//Stores general state about filters, such as current values and the HTML elements linked to them
const filter_state = {};

//Initialize all user filters and present them inside a given HTML element
export function initialize_filters(parent_element, user_filters, properties, page_data) {
  //Iterate through all user selectable filters
  for (const [smw_prop_name, smw_prop_info] of Object.entries(user_filters.properties ?? {})) {
    //Make sure the user filter property is defined correctly
    verify_property(smw_prop_name, 'user filter', properties);

    const property = properties[smw_prop_name];

    //Create a new div container for each filter
    const filter_container = document.createElement('div');
    filter_container.className = 'filter_container';

    //Add the filter title
    const filter_title = document.createElement('div');
    filter_title.className = 'filter_title';
    filter_title.innerHTML = smw_prop_name;
    filter_container.appendChild(filter_title);

    //Create a div container for the filter grid
    const filter_grid = document.createElement('div');
    filter_grid.className = 'filter_grid';
    filter_container.appendChild(filter_grid);

    //Process each filter according to its property type
    switch (property.type) {
      case 'Text':
      case 'Keyword':
      case 'Page':
        //Start with a clean state
        filter_state[smw_prop_name] = {};

        //If the property has predefined values add them all regardless of what's in the page data
        if ('allowed values' in property) {
          for (const allowed_value of property['allowed values']) {
            //Use the first word of the property value as a button label if requested, otherwise use
            //the value as is
            const label = smw_prop_info.first_word_labels?
                          allowed_value.split(' ')[0]:
                          allowed_value;

            //Create the button and add it to the grid
            const button = filter_button_add(filter_grid, label);

            //Set the initial filter state
            filter_state[smw_prop_name][allowed_value] = {
              element: button,
              active: false,
            };

            //Set a button event handler that uses the newly created state object
            button.addEventListener('click', () => {
              filter_button_click(filter_state[smw_prop_name][allowed_value]);
            });
          }
        }
        //If the property has no prefefined values add all values present in the page data
        else {
          const property_value_set = new Set();

          for (const page_properties of Object.values(page_data.query.results)) {
            // console.log(page_properties.printouts[smw_prop_name]);
            for (const smw_prop_value of page_properties.printouts[smw_prop_name]) {
              property_value_set.add(smw_prop_value);
            }
          }

          for (const smw_prop_value of property_value_set) {
            // console.log(smw_prop_value);
            const button = filter_button_add(filter_grid, smw_prop_value);

            filter_state[smw_prop_name][smw_prop_value] = {
              element: button,
              active: false,
            };

            button.addEventListener('click', () => {
              filter_button_click(filter_state[smw_prop_name][smw_prop_value]);
            });
          }
        }
        break;
      default:
        throw new Error(`Unrecognized type for property "${smw_prop_name}": "${property.type}"`);
        break;
    }

    parent_element.appendChild(filter_container);
  }
}

function filter_button_add(parent_element, label) {
  const filter_button = document.createElement('div');
  filter_button.className = 'filter_button';
  filter_button.textContent = label;
  parent_element.appendChild(filter_button);
  return filter_button;
}

function filter_button_click(individual_state) {
  if (individual_state.active) {
    individual_state.element.classList.remove('active');
    individual_state.active = false;
  }
  else {
    individual_state.element.classList.add('active');
    individual_state.active = true;
  }

  filter_results(filter_state);
}
