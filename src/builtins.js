import { builtin_function } from './template-value.js';
import { FunctionCallError } from './errors.js';

//Return an anonymous function that fetches an item from an array or dictionary. If multiple keys
//are specified, the function returns an array with the fetched items instead. This function is
//reminiscent of python's operator.itemgetter function.
export const itemgetter = builtin_function(
  ['...'],
  (...keys) => {
    //Make sure at least one key is provided
    if (keys.length === 0) {
      throw new FunctionCallError('itemgetter: at least one key is required');
    }

    //Make sure all keys are either numbers (for arrays) or strings (for dictionaries)
    if (!keys.every(k => k.type === 'number') && !keys.every(k => k.type === 'string')) {
      throw new FunctionCallError('itemgetter: keys must be all numbers or all strings');
    }

    //Return a callable that takes either an array or dictionary based on the key type and fetches
    //the required items
    return builtin_function(
      [keys[0].type === 'number'? 'array': 'dictionary'],
      keys.length === 1? (aggregate) => aggregate.subscript_access(keys[0]):
                         (aggregate) => keys.map(k => aggregate.subscript_access(k).raw_value)
    );
  }
);

//Call a function for each of the elements of an array and return the results as a new array
export const map = builtin_function(
  ['function', 'array'],
  (callback, iterable) => {
    return [...iterable.iterate(1).map(v => callback.call(v).raw_value)];
  }
);

//Splits a string using a delimiter substring
export const split = builtin_function(
  ['string', 'string=" "'],
  ({ raw_value: string }, { raw_value: delimiter }) => {
    //Passing an empty delimiter results in an error
    if (delimiter.length === 0) {
      throw new FunctionCallError('split: the delimiter must not be an empty string');
    }

    return string.split(delimiter);
  }
);
