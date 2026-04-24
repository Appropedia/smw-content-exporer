import { filter_results } from './result-manager.js';

//Stores general state about filters, such as activation status and HTML elements linked to them
const filter_state = {};

//Initialize all user filters and present them inside a given HTML element
export function initialize_filters(parent_element, user_filters, filter_values) {
  //Iterate through all user selectable filters
  for (const [prop_name, prop_info] of Object.entries(user_filters ?? {})) {
    //Create a new div container for each filter
    const filter_container = document.createElement('div');
    filter_container.className = 'smwce_filter_container';

    //Add the filter title
    const filter_title = document.createElement('div');
    filter_title.className = 'smwce_filter_title';
    filter_title.textContent = prop_name;
    filter_container.appendChild(filter_title);

    //Create a div container for the filter grid
    const filter_grid = document.createElement('div');
    filter_grid.className = 'smwce_filter_grid';
    filter_container.appendChild(filter_grid);

    //Add buttons and set the initial state for all filter values
    filter_state[prop_name] = {};
    for (const value of filter_values[prop_name]) {
      //Use the first word of the property value as a button label if required, otherwise use the
      //value as is
      const label = prop_info.first_word_labels? value.split(' ')[0]: value;

      //Create the button and add it to the grid
      const button = filter_button_add(filter_grid, label);

      //Set the initial filter state
      filter_state[prop_name][value] = {
        element: button,
        active: false,
      };

      //Set a button event handler that uses the newly created state object
      button.addEventListener('click', () => {
        filter_button_click(filter_state[prop_name][value]);
      });
    }

    parent_element.appendChild(filter_container);
  }
}

//Add a filter button to a given parent element
function filter_button_add(parent_element, label) {
  const filter_button = document.createElement('div');
  filter_button.className = 'smwce_filter_button';
  filter_button.textContent = label;
  parent_element.appendChild(filter_button);
  return filter_button;
}

//Process "click" events for buttons
function filter_button_click(individual_state) {
  //Toggle the active state and subclass
  if (individual_state.active) {
    individual_state.element.classList.remove('active');
    individual_state.active = false;
  }
  else {
    individual_state.element.classList.add('active');
    individual_state.active = true;
  }

  //Update the filtered results
  filter_results(filter_state);
}
