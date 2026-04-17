//Make sure a Semantic MediaWiki property exists and has a defined type or throw an error
export function verify_property(smw_prop_name, category, properties) {
  //Make sure the property is defined
  if (!(smw_prop_name in properties)) {
    throw new Error(`Unknown ${category} property: "${smw_prop_name}"`);
  }

  //Make sure the property has a designated type
  if (!('type' in properties[smw_prop_name])) {
    throw new Error(`Property has no defined type: "${smw_prop_name}"`);
  }
}
