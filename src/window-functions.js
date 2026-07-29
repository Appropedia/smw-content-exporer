//Initialize and expose several utility functions to the global window object so that they can be
//called from templates
export function initialize_window_functions(view) {
  //The following local variables are shared among the window and helper functions below
  //------------------------------------------------------------------------------------------------

  //Gather all merge operation options while providing undefined/empty defaults
  const merge_operation = {
    global: view.filters?.global_merge_operation,
    property: view.filters?.individual_merge_operation ?? {},
  };

  //Make sure the global merge operation is valid or undefined
  if (!['conjunction', 'disjunction', undefined].includes(merge_operation.global)) {
    throw new Error(`Invalid global merge operation for view: "${merge_operation.global}"`);
  }

  //Make sure the merge operation is valid for each property that was defined
  Object.entries(merge_operation.property).forEach(([prop_name, operation]) => {
    if (!['conjunction', 'disjunction'].includes(operation)) {
      throw new Error(`Invalid merge operation for property "${prop_name}": "${operation}"`);
    }
  });

  //Initialize the active filters object
  const active_filters = {};

  //Gather all filterable elements from  the document
  const filterable_elements = [];
  document.querySelectorAll('[data-filter-properties]').forEach((element) => {
    const filter_properties = JSON.parse(element.dataset.filterProperties);

    //Make sure the whole attribute string is a JSON object
    if (typeof filter_properties !== 'object' || filter_properties === null ||
        Array.isArray(filter_properties))
    {
      throw new Error('the element property "data-filter-properties" is not a JSON object');
    }

    //Make sure object entries are all arrays
    for (const [k, v] of Object.entries(filter_properties)) {
      if (!Array.isArray(v)) {
        throw new Error(`filter property "${k}" is not a JSON array`);
      }
    }

    filterable_elements.push({ element, filter_properties });
  });

  //The following functions are exposed to the global window object
  //------------------------------------------------------------------------------------------------

  //Toggle the state of a single filter on or off without affecting other filters, invoke the
  //corresponding callback based on the new state and update the visibility of filterable elements
  window.filter_toggle = function(prop_name, prop_value, activation_cb, deactivation_cb) {
    //Check whether the filter is active by checking the existence of the property value
    if (!Object.hasOwn(active_filters[prop_name] ?? {}, prop_value)) {
      //The filter is inactive, activate it
      activate_filter(prop_name, prop_value, activation_cb, deactivation_cb);
    }
    else {
      //The filter is active, deactivate it
      deactivate_filter(prop_name, prop_value);
    }

    update_filterable_elements();
  };

  //Toggle the state of a single filter on or off but turn off other filters if turning it on,
  //invoke the corresponding callback for every affected filter based on the new state and update
  //the visibility of filterable elements
  window.filter_toggle_single = function(prop_name, prop_value, activation_cb, deactivation_cb) {
    //Check whether the filter is active by checking the existence of the property value
    if (!Object.hasOwn(active_filters[prop_name] ?? {}, prop_value)) {
      //The filter is inactive, deactivate all other filters first then activate it
      for (const previous_value of Object.keys(active_filters[prop_name] ?? {})) {
        deactivate_filter(prop_name, previous_value);
      }
      activate_filter(prop_name, prop_value, activation_cb, deactivation_cb);
    }
    else {
      //The filter is active, deactivate it
      deactivate_filter(prop_name, prop_value);
    }

    update_filterable_elements();
  };

  //Set the state of a single filter to on while turning off the others if previously off, invoke
  //the corresponding callback for every affected filter based on the new state and update the
  //visibility of filterable elements
  window.filter_select_single = function(prop_name, prop_value, activation_cb, deactivation_cb) {
    //Check whether the filter is active by checking the existence of the property value
    if (Object.hasOwn(active_filters[prop_name] ?? {}, prop_value)) {
      return;
    }

    //Deactivate all other filters first
    for (const previous_value of Object.keys(active_filters[prop_name] ?? {})) {
      deactivate_filter(prop_name, previous_value);
    }

    //Activate the requested filter and update the filterable elements
    activate_filter(prop_name, prop_value, activation_cb, deactivation_cb);
    update_filterable_elements();
  };

  //The following functions are helpers for the ones above
  //------------------------------------------------------------------------------------------------

  //Activate a filter by adding its deactivation callback to the active filters and invoking its
  //activation callback
  function activate_filter(prop_name, prop_value, activation_cb, deactivation_cb) {
    //Make sure both callbacks are either functions or undefined
    if (!['function', 'undefined'].includes(typeof activation_cb)) {
      throw new Error('invalid filter activation callback');
    }

    if (!['function', 'undefined'].includes(typeof deactivation_cb)) {
      throw new Error('invalid filter deactivation callback');
    }

    active_filters[prop_name] ??= {};
    active_filters[prop_name][prop_value] = deactivation_cb;
    if (activation_cb) activation_cb();
  }

  //Deactivate a filter by removing its deactivation callback from the active filters and then
  //invoking it
  function deactivate_filter(prop_name, prop_value) {
    const deactivation_cb = active_filters[prop_name][prop_value];

    delete active_filters[prop_name][prop_value];
    if (Object.keys(active_filters[prop_name]).length === 0) {
      delete active_filters[prop_name];
    }

    if (deactivation_cb) deactivation_cb();
  }

  //Update the visibility of all filterable elements based on active filter conditions
  function update_filterable_elements() {
    let any_result_visible = false;

    //Iterate through all filterable elements
    for (const { element, filter_properties } of filterable_elements) {
      //Check the filter conditions for each element
      if (check_properties(filter_properties)) {
        //Conditions satisfied, make the element visible
        element.hidden = false;
        any_result_visible = true;
      }
      else {
        //Conditions not satisfied, make the element invisible
        element.hidden = true;
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

  //Check whether the given filter properties satisfy the currently active filters
  function check_properties(filter_properties) {
    const prop_names = Object.keys(active_filters);

    switch (merge_operation.global ?? 'conjunction') {
      case 'conjunction':
        return prop_names.every(name => check_values(name, filter_properties[name] ?? []));
      case 'disjunction':
        return prop_names.some(name => check_values(name, filter_properties[name] ?? []));
    }
  }

  //Check whether the given filter values satisfy the currently active filters
  function check_values(prop_name, filter_values) {
    const prop_values = Object.keys(active_filters[prop_name]);

    switch (merge_operation.property[prop_name] ?? 'conjunction') {
      case 'conjunction':
        return prop_values.every(value => filter_values.includes(value));
      case 'disjunction':
        return prop_values.some(value => filter_values.includes(value));
    }
  }

  //Late initialization
  //------------------------------------------------------------------------------------------------

  //Perform initial hiding/revealing of filterable elements based on initial filter conditions
  update_filterable_elements();
}
