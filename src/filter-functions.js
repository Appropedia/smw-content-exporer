//Initialize and expose filtering functions to the global window object so that they can be called
//from templates
export function initialize_filter_functions(view, page_data) {
  //The following local variables are shared among the window and helper functions below
  //------------------------------------------------------------------------------------------------

  //Gather all merge operation options while providing defaults
  const merge_operation = {
    global: view.filter_merge_operation ?? 'conjunction',
    property: Object.fromEntries(Object.entries(view.filters ?? {}).map(
      ([prop_name, filter_options]) => [prop_name, filter_options.merge_operation ?? 'conjunction']
    )),
  };

  //Make sure the global merge operation is valid
  if (!['conjunction', 'disjunction'].includes(merge_operation.global)) {
    throw new Error(`Invalid filter merge operation for view: "${merge_operation.global}"`);
  }

  //Make sure the merge operation is valid for each property
  Object.entries(merge_operation.property).forEach(([prop_name, operation]) => {
    if (!['conjunction', 'disjunction'].includes(operation)) {
      throw new Error(`Invalid merge operation for property "${prop_name}": "${operation}"`);
    }
  });

  //Initialize the active filters object
  const active_filters = {};

  //The following functions are exposed to the global window object
  //------------------------------------------------------------------------------------------------

  //Toggle the state of a single filter on or off without affecting other filters, then update the
  //visibility of filtered result elements
  window.filter_toggle = function(prop_name, prop_value, element, active_class, inactive_class) {
    //Check whether the filter is active by checking if the property value exists
    if (active_filters?.[prop_name]?.[prop_value] === undefined) {
      //The filter is inactive, activate it
      activate_filter(prop_name, prop_value, element, active_class, inactive_class);
    }
    else {
      //The filter is active, deactivate it
      deactivate_filter(prop_name, prop_value);
    }

    //Update the filtered results
    filter_results();
  };

  //Toggle the state of a single filter on or off but turn off other filters if turning on, then
  //update the visibility of filtered result elements
  window.filter_toggle_single = function(prop_name, prop_value, element, active_class,
                                         inactive_class)
  {
    //Check whether the filter is active by checking if the property value exists
    if (active_filters?.[prop_name]?.[prop_value] === undefined) {
      //The filter is inactive, deactivate all other filters first then activate it
      for (const previous_value of Object.keys(active_filters[prop_name] ?? {})) {
        deactivate_filter(prop_name, previous_value);
      }
      activate_filter(prop_name, prop_value, element, active_class, inactive_class);
    }
    else {
      //The filter is active, reset the filter
      deactivate_filter(prop_name, prop_value);
    }

    //Update the filtered results
    filter_results();
  };

  //Set the state of a single filter to on while turning off the others, then update the visibility
  //of filtered result elements
  window.filter_select_single = function(prop_name, prop_value, element, active_class,
                                         inactive_class)
  {
    //Deactivate all other filters first
    for (const previous_value of Object.keys(active_filters[prop_name] ?? {})) {
      deactivate_filter(prop_name, previous_value);
    }

    //Activate the requested filter and update the filtered results
    activate_filter(prop_name, prop_value, element, active_class, inactive_class);
    filter_results();
  };

  //The following functions are helpers for the ones above
  //------------------------------------------------------------------------------------------------

  //Activate a filter by adding it to the active filters and toggling the CSS classes of the
  //provided document element (if any)
  function activate_filter(prop_name, prop_value, element, active_class, inactive_class) {
    //Create a new state object for the requested name/value pair
    active_filters[prop_name] = active_filters[prop_name] ?? {};
    const filter_state = active_filters[prop_name][prop_value] = {};

    //Append the document element if provided
    if (element !== undefined) {
      filter_state.element = element;
    }

    //Append and set the active class to the element if provided
    if (active_class !== undefined) {
      filter_state.active_class = active_class;
      element.classList.add(active_class);
    }

    //Append and remove the inactive class to the element if provided
    if (inactive_class !== undefined) {
      filter_state.inactive_class = inactive_class;
      element.classList.remove(inactive_class);
    }
  }

  //Deactivate a filter by toggling the stored CSS classes on the stored element (if any) and
  //removing it from the active filters
  function deactivate_filter(prop_name, prop_value) {
    const filter_state = active_filters[prop_name][prop_value];

    //Toggle the active and inactive classes on the stored element if they exist
    if (Object.hasOwn(filter_state, 'element')) {
      if (Object.hasOwn(filter_state, 'active_class')) {
        filter_state.element.classList.remove(filter_state.active_class);
      }
      if (Object.hasOwn(filter_state, 'inactive_class')) {
        filter_state.element.classList.add(filter_state.inactive_class);
      }
    }

    //Remove the state object
    delete active_filters[prop_name][prop_value];
    if (Object.keys(active_filters[prop_name]).length === 0) {
      delete active_filters[prop_name];
    }
  }

  //Filter all result pages by hiding/revealing them based on active filter conditions
  function filter_results() {
    let any_result_visible = false;

    //Iterate through all page results
    for (const page_title of Object.keys(page_data.query?.results ?? {})) {
      //Check the filter conditions for this page
      const filters_satisfied = check_page(page_title);

      //Update the visibility of all elements tagged with the page title
      document.querySelectorAll(`[data-page-title="${CSS.escape(page_title)}"]`).forEach(
        element => element.hidden = !filters_satisfied
      );

      //Set the flag if any page satisfies the filter conditions
      if (filters_satisfied) {
        any_result_visible = true;
      }
    }

    //Update the visibility of all elements tagged for showing when results are empty
    document.querySelectorAll('[data-show-when-results-empty]').forEach(
      element => element.hidden = any_result_visible
    );

    //Update the visibility of all elements tagged for showing when all filters are deactivated
    const any_filter_active = Object.keys(active_filters).length !== 0;
    document.querySelectorAll('[data-show-when-filters-clear]').forEach(
      element => element.hidden = any_filter_active
    );
  }

  //Check whether the semantic properties of a page satisfy the currently active filters
  function check_page(page_title) {
    const property_names = Object.keys(active_filters);

    switch (merge_operation.global) {
      case 'conjunction':
        return property_names.every(prop_name => check_property(page_title, prop_name));
      case 'disjunction':
        return property_names.some(prop_name => check_property(page_title, prop_name));
    }
  }

  //Check whether the semantic property values of a page satisfy the currently active filters
  function check_property(page_title, prop_name) {
    const filter_values = Object.keys(active_filters[prop_name]);
    const page_values = get_page_property_values(page_title, prop_name);

    switch (merge_operation.property[prop_name]) {
      case 'conjunction':
        return filter_values.every(prop_value => page_values.includes(prop_value));
      case 'disjunction':
        return filter_values.some(prop_value => page_values.includes(prop_value));
    }
  }

  //Get the semantic property values of a given page
  function get_page_property_values(page_title, prop_name) {
    const type_info = page_data.query.printrequests.filter(pr => pr.label === prop_name)[0];
    const printout_values = page_data.query.results[page_title].printouts[prop_name];

    switch (type_info.typeid) {
      case '_keyw':
        return printout_values;
      case '_wpg':
        return printout_values.map(page => page.fulltext);
      default:
        throw new Error(`Unimplemented support for type of property "${prop_name}": ` +
                        `"${type_info.typeid}"`);
    }
  }

  //Late initialization
  //------------------------------------------------------------------------------------------------

  //Perform initial hiding/revealing of result pages based on initial filter conditions
  filter_results();
}
