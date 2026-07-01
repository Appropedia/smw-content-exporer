import { builtin_function, FunctionCallError } from './template-value.js';

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
