import { filter_results } from './result-manager.js';

//Stores general state about filters, such as activation status and HTML elements linked to them
const filter_state = {};

//Initialize all user filters and present them inside a given HTML element
export function initialize_filters(parent_element, user_filters, filter_merge_op, filter_values) {
  //Validate and provide defaults for the filter merge operation argument
  filter_merge_op = filter_merge_op ?? 'conjunction';
  if (!['conjunction', 'disjunction'].includes(filter_merge_op)) {
    throw new Error(`Invalid filter merge operation for view: "${filter_merge_op}"`);
  }

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

    //Validate and provide defaults for the value merge operation property
    const value_merge_op = prop_info.merge_operation ?? 'conjunction';
    if (!['conjunction', 'disjunction'].includes(value_merge_op)) {
      throw new Error(`Invalid merge operation for property "${prop_name}": "${value_merge_op}"`);
    }

    //Prepare a new filter state entry for this property
    filter_state[prop_name] = {
      value_merge_op: value_merge_op,
      values: {}
    };

    //Add buttons and set the initial state for all filter values of this property
    for (const value of filter_values[prop_name]) {
      //Use the first word of the property value as a button label if required, otherwise use the
      //value as is
      const label = prop_info.first_word_labels? value.split(' ')[0]: value;

      //Create the button and add it to the grid
      const button = filter_button_add(filter_grid, label);

      //Set the initial filter state
      filter_state[prop_name].values[value] = {
        element: button,
        active: false,
      };

      //Set a button event handler that uses the newly created state object
      button.addEventListener('click', () => {
        filter_button_click(prop_name, value, filter_merge_op, prop_info.single_selection);
      });
    }

    parent_element.appendChild(filter_container);
  }

  //Apply the initial filter operation to the results
  filter_results(filter_state, filter_merge_op);
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
function filter_button_click(prop_name, value, filter_merge_op, single_selection) {
  const current_state = filter_state[prop_name].values[value];

  //Toggle the active state and subclass
  if (current_state.active) {
    current_state.element.classList.remove('active');
    current_state.active = false;
  }
  else {
    current_state.element.classList.add('active');
    current_state.active = true;

    //If single selection is enabled for this filter, disable all other possibly enabled buttons
    if (single_selection) {
      for (const fs_item of Object.values(filter_state[prop_name].values)) {
        if (fs_item !== current_state && fs_item.active) {
          fs_item.element.classList.remove('active');
          fs_item.active = false;
        }
      }
    }
  }

  //Update the filtered results
  filter_results(filter_state, filter_merge_op);
}
