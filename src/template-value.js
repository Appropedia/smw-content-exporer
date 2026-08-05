import { TypeMismatchError, IterateError, SubscriptAccessError, FunctionCallError }
from './errors.js';

//Instantiate a TemplateValue object from a possibly untrusted raw value
export function create_value(raw_value) {
  //Make sure the provided type is supported
  verify_supported_types(raw_value);

  //Create a new TemplateValue object from the raw value, but make sure to convert all non
  //null-prototype objects to null-prototype ones to protect against prototype pollution attacks
  return create_value_from_trusted(strip_prototypes(raw_value));
}

//Verfify that a given raw value is of one of the supported types or is composed of them
function verify_supported_types(raw_value) {
  switch (typeof raw_value) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'function':
      //All types above are supported
      break;
    case 'object':
      //Arrays are supported
      if (Array.isArray(raw_value)) {
        //Verify array contents recursively
        raw_value.forEach(v => verify_supported_types(v));
        break;
      }

      //Objects are supported but only if they're plain ones
      if (raw_value !== null && Object.getPrototypeOf(raw_value) === Object.prototype) {
        //Verify object contents recursively
        Object.values(raw_value).forEach(v => verify_supported_types(v));
        break;
      }

      throw new Error('Raw value object with unsupported prototype: ' +
                      `${Object.getPrototypeOf(raw_value)}`);
    default:
      throw new Error(`Unsupported raw value type: ${typeof raw_value}`);
  }
}

//Instantiate a TemplateValue object from a trusted raw value
function create_value_from_trusted(raw_value) {
  //Map the raw value to a type recognized by this type system
  switch (typeof raw_value) {
    case 'number':
      return new NumberValue(raw_value);
    case 'string':
      return new StringValue(raw_value);
    case 'boolean':
      return new BoolValue(raw_value);
    case 'object':
      if (Array.isArray(raw_value)) {
        return new ArrayValue(raw_value);
      }
      else {
        return new DictionaryValue(raw_value);
      }
    case 'function':
      return new FunctionValue(raw_value);
  }
}

//Given a native raw value, which may be of a compound type and contain objects and/or be an object
//itself, create a new raw value that can only contain null-prototype objects, effectively stripping
//their prototypes
function strip_prototypes(raw_value) {
  //Primitive types don't need stripping
  if (raw_value === null || typeof raw_value !== 'object') {
    return raw_value;
  }

  //Array types themselves don't need stripping, but their elements possibly do, so strip them
  //recursively
  if (Array.isArray(raw_value)) {
    return raw_value.map(v => strip_prototypes(v));
  }

  //The raw value is another type of object (a plain one is assumed) so stripping is needed, start
  //by creating a new null-prototype object
  const stripped_object = Object.create(null);

  //Iterate the object safely by using Object.entries (which ignores inherited properties), then
  //populate the clean object with the original members by stripping them recursively
  for (const [k, v] of Object.entries(raw_value)) {
    stripped_object[k] = strip_prototypes(v);
  }

  return stripped_object;
}

//Base class for types supported by the template language
class TemplateValue {
  #raw_value;

  constructor(raw_value) {
    this.#raw_value = raw_value;
  }

  //Base class methods

  get raw_value() {
    return this.#raw_value;
  }

  //Implement all child methods as error handlers for children that do not implement them

  get type() {
    throw new Error(`Class ${this.constructor.name} has no type getter`);
  }

  iterate(_var_count) {
    throw new TypeMismatchError(`cannot perform iteration on ${this.type} type`);
  }

  operator_subscription(_rhs) {
    throw new TypeMismatchError(`cannot perform subscription on ${this.type} type`);
  }

  operator_in(_lhs) {
    throw new TypeMismatchError(`cannot perform membership test inside of ${this.type} type`);
  }

  operator_not_in(_lhs) {
    throw new TypeMismatchError(`cannot perform membership test inside of ${this.type} type`);
  }

  operator_call(..._args) {
    throw new TypeMismatchError(`cannot perform calls on ${this.type} type`);
  }
}

class NumberValue extends TemplateValue {
  get type() { return 'number'; }

  constructor(raw_value) {
    super(raw_value);
  }
}

class StringValue extends TemplateValue {
  get type() { return 'string'; }

  constructor(raw_value) {
    super(raw_value);
  }
}

class BoolValue extends TemplateValue {
  get type() { return 'bool'; }

  constructor(raw_value) {
    super(raw_value);
  }
}

class ArrayValue extends TemplateValue {
  get type() { return 'array'; }

  constructor(raw_value) {
    super(raw_value);
  }

  *iterate(var_count) {
    if (var_count != 1) {
      throw new IterateError('arrays can only be iterated with a single variable');
    }

    for (const item of this.raw_value) {
      yield create_value_from_trusted(item);
    }
  }

  operator_subscription(rhs) {
    if (rhs.type !== 'number') {
      throw new TypeMismatchError(`cannot subscript arrays using ${rhs.type} values`);
    }

    if (!Number.isInteger(rhs.raw_value)) {
      throw new SubscriptAccessError('cannot subscript arrays using non-integer indexes');
    }

    if (rhs.raw_value < 0) {
      throw new SubscriptAccessError('cannot subscript arrays using negative indexes');
    }

    if (rhs.raw_value >= this.raw_value.length) {
      throw new SubscriptAccessError('array subscription index exceeds array size');
    }

    return create_value_from_trusted(this.raw_value[rhs.raw_value]);
  }
}

class DictionaryValue extends TemplateValue {
  get type() { return 'dictionary'; }

  constructor(raw_value) {
    super(raw_value);
  }

  *iterate(var_count) {
    switch (var_count) {
      case 1:
        for (const k of Object.keys(this.raw_value)) {
          yield create_value_from_trusted(k);
        }
        break;
      case 2:
        for (const [k, v] of Object.entries(this.raw_value)) {
          yield [create_value_from_trusted(k), create_value_from_trusted(v)];
        }
        break;
      default:
        throw new IterateError('can only iterate dictionary with 1 or 2 variables');
    }
  }

  operator_subscription(rhs) {
    if (rhs.type !== 'string') {
      throw new TypeMismatchError(`cannot subscript dictionaries using ${rhs.type} values`);
    }

    if (!Object.hasOwn(this.raw_value, rhs.raw_value)) {
      throw new SubscriptAccessError(`dictionary has no "${rhs.raw_value}" entry`);
    }

    return create_value_from_trusted(this.raw_value[rhs.raw_value]);
  }

  operator_in(lhs) {
    if (lhs.type != 'string') {
      throw new TypeMismatchError(`Cannot perform membership test of ${lhs.type} type inside of ` +
                                  'dictionary type');
    }

    return create_value_from_trusted(Object.hasOwn(this.raw_value, lhs.raw_value));
  }

  operator_not_in(lhs) {
    if (lhs.type != 'string') {
      throw new TypeMismatchError(`Cannot perform membership test of ${lhs.type} type inside of ` +
                                  'dictionary type');
    }

    return create_value_from_trusted(!Object.hasOwn(this.raw_value, lhs.raw_value));
  }
}

class FunctionValue extends TemplateValue {
  get type() { return 'function'; }

  constructor(raw_value) {
    super(raw_value);
  }

  operator_call(...args) {
    return this.raw_value(...args);
  }
}

//Decorator for functions built into the template language
//Parameters:
//- param_descriptors: An array of strings that describe the parameters that the function accepts,
//  with the following possible formats:
//  - 'type1|type2|...|typeN': Defines a required parameter of any of the specified types. Valid
//    types are those returned by the 'type' getter of the TemplateValue classes.
//  - 'type1|type2|...|typeN=default': Similar to previous but also defines a default value, making
//    the parameter optional. The default value is any valid expression for JSON.parse that can be
//    mapped to a TemplateValue class instance.
//  - '...': Defines a group of variadic parameters of any type. The provided callback function
//    should have a corresponding rest (...) parameter in the same position as well.
//- fn: A callback function which is invoked with the parameters provided in the template function
//  call. The following rules apply:
//  - If the template call fails to pass a valid amount and type of arguments, that call fails and
//    the callback is not invoked.
//  - If optional parameters are omitted in the template call, their default values are collected
//    and passed to the callback, this way all optional values are always passed.
//  - The callback can return a TemplateValue class object directly or a raw value, which will be
//    promoted automatically to a TemplateValue class object anyway.
export function builtin_function(param_descriptors, fn) {
  //Map the parameter kind ordering to integers
  const parameter_kind = Object.freeze({
    required: 0,
    optional: 1,
    variadic: 2,
  });

  //Regex used for identifying and decomposing parameter descriptors (in order from more specific to
  //less specific)
  const param_regex = new RegExp(
    [
      '^(?<variadic>\\.\\.\\.)$',                                   //Literal ellipsis
      '^(?<optional>[a-z]+(?:\\|[a-z]+)*)=(?<default_value>.*)$',   //type1|type2|...|typeN=default
      '^(?<required>[a-z]+(?:\\|[a-z]+)*)$'                         //type1|type2|...|typeN
    ].join('|'),
    'g'
  );

  //The following loop performs the following tasks:
  //- Verify the parameter kind ordering (required => optional => variadic)
  //- Count the required parameters
  //- Collect the default values of optional parameters
  //- Check the presence of the variadic argument
  //- Collect the valid types of required and optional parameters
  let current_kind = parameter_kind.required;
  let required_param_count = 0;
  const default_values = [];
  let variadic_param_present = false;
  const param_types = [];
  for (const descriptor of param_descriptors) {
    //Analyze the next parameter descriptor string
    param_regex.lastIndex = 0;  //Reuse the regex object by restarting it
    const match = param_regex.exec(descriptor);

    //Perform the next actions based on the identified parameter kind
    if (match?.groups?.required !== undefined) {
      //Required parameter - can only come before others
      switch (current_kind) {
        case parameter_kind.required:
          required_param_count++;
          param_types.push(match.groups.required.split('|'));
          break;
        case parameter_kind.optional:
          throw new Error('Required parameter after optional parameter');
        case parameter_kind.variadic:
          throw new Error('Required parameter after variadic parameter');
      }
    }
    else if (match?.groups?.optional !== undefined) {
      //Optional parameter - can only come between required and variadic
      switch (current_kind) {
        case parameter_kind.required:
          current_kind = parameter_kind.optional;   //Fall through
        case parameter_kind.optional:
          default_values.push(create_value(JSON.parse(match.groups.default_value)));
          param_types.push(match.groups.optional.split('|'));
          //Make sure the default value is of a valid type
          if (!param_types.at(-1).includes(default_values.at(-1).type)) {
            const param_num = required_param_count + default_values.length;
            const formatter = new Intl.ListFormat('en-GB', { style: 'long', type: 'disjunction' });
            throw new Error(`Wrong type for default value of parameter #${param_num}: ` +
                            `${default_values.at(-1).type} (should be ` +
                            `${formatter.format(param_types.at(-1))})`);
          }
          break;
        case parameter_kind.variadic:
          throw new Error('Optional parameter after variadic parameter');
      }
    }
    else if (match?.groups?.variadic !== undefined) {
      //Variadic parameter - can only come last once
      switch (current_kind) {
        case parameter_kind.required:
        case parameter_kind.optional:
          variadic_param_present = true;
          current_kind = parameter_kind.variadic;
          break;
        case parameter_kind.variadic:
          throw new Error('Multiple variadic parameters');
      }
    }
    else {
      throw new Error(`Unrecognized parameter format: "${descriptor}"`);
    }
  }

  //Return a wrapper that performs all checks and then invokes the provided function
  return function(...call_args) {
    //Make sure the function is called with the minimum required amount of parameters
    if (call_args.length < required_param_count) {
      throw new FunctionCallError('insuficient parameters for function call - call signature: ' +
                                  `(${param_descriptors.map(p => `<${p}>`).join(', ')})`);
    }

    //Make sure the function is not called with more parameters than it can take
    if (!variadic_param_present && call_args.length > param_types.length) {
      throw new FunctionCallError('too many parameters for function call - call signature: ' +
                                  `(${param_descriptors.map(p => `<${p}>`).join(', ')})`);
    }

    //Make sure the provided arguments are of the correct type
    call_args.slice(0, param_types.length).forEach((arg, index) => {
      if (!param_types[index].includes(arg.type)) {
        const formatter = new Intl.ListFormat('en-GB', { style: 'long', type: 'disjunction' });
        throw new TypeMismatchError(`wrong type for parameter #${index + 1} in function call: ` +
                                    `${arg.type} (should be ` +
                                    `${formatter.format(param_types[index])})`);
      }
    });
    //Note: The slice on call_args limits the check to all types defined in param_types (eliminates
    //overflowing caused by potential variadic arguments)

    //Complete the call arguments with as many default parameters as needed
    if (call_args.length < param_types.length) {
      call_args = [...call_args, ...default_values.slice(call_args.length - param_types.length)];
      //Note: Negative slicing is intended, this way only the last default values are taken
    }

    //Perform the wrapped function call by relaying the arguments, then promote the return value to
    //a TemplateValue instance if needed
    const return_value = fn(...call_args);
    return (return_value instanceof TemplateValue)? return_value: create_value(return_value);
  };
}
