import { TemplateError } from './lexical-analyzer.js';

//Strings and regular expressions for creation and parsing of untrusted value tokens
const token_prefix = '__SMWCE_';
const token_suffix = '__';
const token_repl_regex = /__SMWCE_([0-9]+)__/g;
const token_match_regex = /^__SMWCE_([0-9]+)__$/;

//List of DOM element attributes for which code expansion is allowed
const code_attribute_whitelist = new Set(['onclick']);

//List of DOM element attributes for which free-form expansion is allowed
const safe_attribtue_whitelist = new Set(['data-page-title']);

//Append an arbitrary amount of DOM nodes to an array, merging contigous text nodes in the process
function append_merge_nodes(node_array, ...new_nodes) {
  for (const node of new_nodes) {
    if (node_array.at(-1)?.nodeType === Node.TEXT_NODE && node.nodeType === node.TEXT_NODE) {
      //Consecutive text node encountered, merge
      node_array.at(-1).nodeValue += node.nodeValue;
    }
    else {
      //Append to the array otherwise
      node_array.push(node);
    }
  }
}

//Recursively build an array DOM nodes with the representation of a value
function nodes_from_value(location, value, quote_strings = false) {
  switch (typeof value) {
    case 'number':
      //Numbers are converted to strings and then wrapped in text nodes
      return [ document.createTextNode(value.toString()) ];
    case 'string':
      //Strings are wrapped in text nodes directly
      return [ document.createTextNode(quote_strings? '"' + value + '"': value) ];
    case 'object':
      if (Array.isArray(value)) {
        //Arrays are wrapped in unordered lists (ul) surrounded by brackets
        const ul = document.createElement('ul');
        ul.style['list-style-type'] = 'none';

        //Each array item is wrapped in a list item (li) recursively
        for (const item of value) {
          const li = document.createElement('li');
          nodes_from_value(location, item, true).forEach((node) => li.appendChild(node));
          ul.appendChild(li);
        }

        return [ document.createTextNode('['), ul, document.createTextNode(']') ];
      }
      else if (value !== null && Object.getPrototypeOf(value) === null) {
        //Dictionaries are wrapped in unordered lists (ul) surrounded by braces
        const ul = document.createElement('ul');
        ul.style['list-style-type'] = 'none';

        //Each dictionary entry is wrapped in a list item (li) recursively
        for (const [k, v] of Object.entries(value)) {
          const entry_nodes = [document.createTextNode(k + ': ')];
          append_merge_nodes(entry_nodes, ...nodes_from_value(location, v, true));
          const li = document.createElement('li');
          entry_nodes.forEach((node) => li.appendChild(node));
          ul.appendChild(li);
        }

        return [ document.createTextNode('{'), ul, document.createTextNode('}') ];
      }
      else {
        throw new TemplateError(location, `displaying of insecure objects is not allowed`);
      }
    default:
      throw new Error(`Invalid type passed to function: ${typeof value}`);
  }
}

//Class used for efficient storage and retrieval of template value information objects. It creates a
//composite key map by nesting Map class objects - one per key, as the Map class doesn't support
//composite keys natively. Keys are ordered from most to least repetitive, favoring cached hits.
class ValueInfoMap {
  #map_0 = new Map();
  #value_info_array = [];

  //Store a possibly new template value information object and return its unique index (if duplicate
  //return the existing index instead)
  set(value_info) {
    const { type, location, value } = value_info;

    //Retrieve the secondary map from the primary one if it exists or create a new one
    let map_1 = this.#map_0.get(type);
    if (map_1 === undefined) {
      map_1 = new Map();
      this.#map_0.set(type, map_1);
    }

    //Retrieve the tertiary map from the secondary one if it exists or create a new one
    let map_2 = map_1.get(location);
    if (map_2 === undefined) {
      map_2 = new Map();
      map_1.set(location, map_2);
    }

    //Look up the index in the tertiary map and return it if it exists
    let index = map_2.get(value);
    if (index !== undefined) {
      return index;
    }

    //The template value information object is not present; get the next available index in the
    //array, store it in the tertiary map and then push the whole object into the array
    index = this.#value_info_array.length;
    map_2.set(value, index);
    this.#value_info_array.push(value_info);

    return index;
  }

  //Retrieve a stored template value information object identified by its unique index
  get(index) {
    return this.#value_info_array[index];
  }
}

//Class used for safely building a DOM from a trusted preprocessed template and a set of untrusted
//values
export class TemplateBuilder {
  #value_info_map = new ValueInfoMap();
  #composite_value_display_warned = false;

  //Register an untrusted TemplateValue object with the class and obtain a token that represents it
  register_untrusted_value(location, template_value) {
    //Register the template value information and get a unique index (or retrieve the existing one)
    const index = this.#value_info_map.set({
      type: template_value.type,
      location: location,
      value: template_value.raw_value,
    });

    return `${token_prefix}${index}${token_suffix}`;
  }

  //Create a document fragment from a given HTML string, safely expanding all untrusted value tokens
  //in the process
  expand_html(html_text) {
    //Build a new DOM parser and create a new document from the provided HTML text
    const parser = new DOMParser();
    const doc = parser.parseFromString(html_text, 'text/html');

    //Create a node iterator object that visits only the nodes that contain untrusted value tokens
    const iterator = doc.createNodeIterator(
      doc.body,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          switch (node.nodeType) {
            case Node.TEXT_NODE:
              if (node.nodeValue.includes(token_prefix))
                return NodeFilter.FILTER_ACCEPT;
              break;
            case Node.ELEMENT_NODE:
              for (const attribute of node.attributes) {
                if (attribute.value.includes(token_prefix))
                  return NodeFilter.FILTER_ACCEPT;
              }
              break;
          }

          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    //Now use the iterator to traverse the nodes mentioned above and perform actual token
    //substitution
    let node;
    while ((node = iterator.nextNode()) !== null) {
      switch (node.nodeType) {
        case Node.TEXT_NODE:
          //Text nodes are replaced with their expanded versions
          node.replaceWith(...this.#expand_text_node(node));
          break;
        case Node.ELEMENT_NODE:
          for (const attribute of node.attributes) {
            if (attribute.name === 'href' || attribute.name === 'src') {
              //Expand URLs safely for attributes that deal with them
              attribute.value = this.#expand_url(attribute.value);
            }
            else if (code_attribute_whitelist.has(attribute.name)) {
              //Expand untrusted value tokens in allowed JavasScript code attributes as JSON in
              //order to disallow escape sequences leading to XSS
              attribute.value = attribute.value.replaceAll(token_repl_regex, (_match, id) => {
                const { type, location, value } = this.#value_info_map.get(+id);
                if (!['number', 'string'].includes(type)) {
                  throw new TemplateError(location, `wrong type for ${attribute.name} attribute: ` +
                                          `${type} (should be string or number)`);
                }
                //Note: At the moment of writing there was no need of allowing types other than the
                //basic ones, so they're restricted for added security. There's also a potential
                //performance issue if composite types such as dictionaries or arrays are allowed,
                //as they're converted to JSON and then parsed again.
                return JSON.stringify(value);
              });
            }
            else if (safe_attribtue_whitelist.has(attribute.name)) {
              //Expand untrusted value tokens directly for attributes that are considered safe
              attribute.value = attribute.value.replaceAll(token_repl_regex, (_match, id) => {
                const { type, location, value } = this.#value_info_map.get(+id);
                if (!['number', 'string'].includes(type)) {
                  throw new TemplateError(location, `wrong type for ${attribute.name} attribute: ` +
                                          `${type} (should be string or number)`);
                }
                return value;
              });
            }
          }
          break;
      }
    }

    //Create a document fragment and move all children from the parsed document to it
    const fragment = document.createDocumentFragment();
    while (doc.body.firstChild) {
      fragment.appendChild(doc.body.firstChild);
    }

    return fragment;
  }

  //Safely expand all untrusted value tokens in a DOM text node
  #expand_text_node(text_node) {
    const new_nodes = [];   //Holds the nodes that will replace the initial text node
    let last_index = 0;     //Tracks the ending position of the current match
    let prev_index = 0;     //Tracks the ending position of the previous match

    //Walk over the initial text node looking for untrusted value tokens
    for (const match of text_node.nodeValue.matchAll(token_repl_regex)) {
      //Update the ending position
      last_index = match.index + match[0].length;

      //Append/merge a text node for any text between tokens
      if (match.index > prev_index) {
        const node = document.createTextNode(text_node.nodeValue.slice(prev_index, match.index));
        append_merge_nodes(new_nodes, node);
        prev_index = last_index;
      }

      //Retrieve the untrusted value information
      const { type, location, value } = this.#value_info_map.get(+match[1]);

      //Perform a check on supported types
      switch (type) {
        case 'number':
        case 'string':
          //These types are always allowed
          break;
        case 'array':
        case 'dictionary':
          //These types trigger a one time warning
          if (!this.#composite_value_display_warned) {
            console.warn(`${location}: warning: Direct display of composite values should only ` +
              'be used as a debug feature, please consider iterating through them to apply ' +
              'proper format');
            this.#composite_value_display_warned = true;
          }
          break;
        default:
          //Other types are disallowed
          throw new TemplateError(location, `displaying of ${type} type is unsupported`);
      }

      //Create one or mode nodes from the current untrusted value, then append/merge them
      append_merge_nodes(new_nodes, ...nodes_from_value(location, value));
    }

    //Append any trailing text as the last text node
    if (last_index < text_node.nodeValue.length) {
      const node = document.createTextNode(text_node.nodeValue.slice(last_index));
      append_merge_nodes(new_nodes, node);
    }

    return new_nodes;
  }

  //Perform security checks and expand untrusted value tokens in a given URL
  #expand_url(url_text) {
    //Check wether the URL consists of a single untrusted value token
    const match = token_match_regex.exec(url_text.trim());
    if (match !== null) {
      //The URL consists of a single token; since no URL structure is imposed by the template, only
      //basic checks will be performed

      //Retrieve the untrusted value information
      const { type, location, value } = this.#value_info_map.get(+match[1]);

      //Make sure the value is a string
      if (type !== 'string') {
        throw new TemplateError(location, `wrong type for URL expression: ${type} (should be ` +
                                'string)');
      }

      //Create a clean version of the value by removing all leading/trailing whitespace and
      //converting to lowercase, then eliminate any potential obfuscation by removing any control or
      //invisible character ignored by browsers
      //eslint-disable-next-line no-control-regex
      const spc_chars = /[\x00-\x1F\x7F-\x9F\u00AD\u200B-\u200D\u200E\u200F\u202A-\u202E\uFEFF]/g;
      const clean_value = value.trim().toLowerCase().replace(spc_chars, '');

      //Make sure the link doesn't contain a potentially malicious protocol
      if (clean_value.startsWith('javascript:') || clean_value.startsWith('data:') ||
          clean_value.startsWith('vbscript:'))
      {
        console.warn(`${location}: warning: potentially malicious link detected and blocked`);
        return 'about:blank';
      }

      return value;
    }

    //At this point the URL is assumed to have a general structure imposed by the template code;
    //Check whether the given URL is absolute and create a new URL object based on that
    const url_is_absolute = url_text.includes('://') || url_text.startsWith('//');
    const base_placeholder = 'https://placeholder/';
    const url = url_is_absolute? new URL(url_text): new URL(url_text, base_placeholder);

    //Check for URL request parameters
    if (url.search.length > 0) {
      //URL request parameters present; the expanded parameters will be stored separately
      const expanded_params = new URLSearchParams();

      //Perform parameter expansion now
      for (const [k, v] of url.searchParams.entries()) {
        //Expand URL parameter keys
        const expanded_key = k.replaceAll(token_repl_regex, (_match, id) => {
          const { type, location, value } = this.#value_info_map.get(+id);
          if (type !== 'string') {
            throw new TemplateError(location, `wrong type for URL parameter key: ${type} (should ` +
                                    'be string)');
          }
          return value;
        });

        //Expand URL parameter values
        const expanded_val = v.replaceAll(token_repl_regex, (_match, id) => {
          const { type, location, value } = this.#value_info_map.get(+id);
          switch (type) {
            case 'number':
              return value.toString();
            case 'string':
              return value;
            default:
              throw new TemplateError(location, `wrong type for URL parameter value: ${type} ` +
                                      '(should be number or string)');
          }
        });

        expanded_params.append(expanded_key, expanded_val);
      }

      //Replace the request parameters with the expanded ones
      url.search = expanded_params.toString();
    }

    //Note: Only request parameter substitution is supported; this is intended and means that no
    //expansion is done to other parts of the url that are more sensitive, in particular the
    //protocol, hostname and port. As a consequence template-structured URLs will be broken if they
    //contain expressions in said parts.

    //Return an URL of the same kind (absolute or relative) as the one defined in the template
    return url_is_absolute? url.toString(): url.toString().replace(base_placeholder, '');
  }
}
