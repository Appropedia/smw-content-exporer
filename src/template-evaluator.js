import { TemplateError, EvaluationError, ScopeError, IncludeError } from './errors.js';
import { create_value } from './template-value.js';
import { Parser } from './parser.js';
import { TemplateBuilder } from './template-builder.js';

const templates = {};       //Contains raw text and parsed AST for every template
const template_stack = [];  //Tracks all templates currently being expanded
const template_builder = new TemplateBuilder();   //Builds the parsed DOM safely

//Class for scoped variable namespaces
class Scope {
  #record;  //Object holding all variables in the local scope
  #parent;  //Points to the parent scope (for scope resolution)

  constructor(parent, record = {}) {
    this.#parent = parent;

    //Recursively map each entry in the record initializer to a new TemplateValue instance so that
    //its type is detected automatically
    this.#record = Object.fromEntries(Object.entries(record).map(([k, v]) => [k, create_value(v)]));
  }

  //Get any variable visible from the current scope
  get(name) {
    //Look in the local scope and return the variable if found
    if (Object.hasOwn(this.#record, name)) {
      return this.#record[name];
    }

    //Look in the parent scope otherwise
    if (this.#parent !== null) {
      return this.#parent.get(name);
    }

    throw new ScopeError(`identifier "${name}" is not available in current scope`);
  }

  //Set a variable in the local scope
  set(name, value) {
    this.#record[name] = value;
  }
}

//Set of functions used to evaluate the AST
const evaluator = {
  //Note: The angle bracket syntax "<>" syntax refers to the BNF symbols defined in parser.js

  //Evaluate a <template> AST object
  template(template, scope) {
    //A <template> object can be composed of any amount of <template_element>. When evaluated each
    //returns a string, so concatenate all into a single string
    return template.elements.reduce((accumulator, element) => {
      return accumulator + evaluate(element, scope);
    }, '');
  },

  //Evaluate a <raw_text_element> AST object
  raw_text_element(element, _scope) {
    return element.raw_text;  //This is a string already, return it directly
  },

  //Evaluate the root template or an <include_statement> AST object
  include_statement(statement, scope, globals = {}) {
    //Evaluate the unit name first
    const { type: expr_type, raw_value: unit_name } = evaluate(statement.unit_name, scope);

    //Make sure the unit name was correctly evaluated to a string
    if (expr_type !== 'string') {
      throw new IncludeError(`cannot include units using ${expr_type} values`);
    }

    //Make sure the template is defined in the view
    if (!Object.hasOwn(templates, unit_name)) {
      throw new IncludeError(`template "${unit_name}" not defined in view`);
    }

    //Also make sure the template isn't in the template stack
    if (template_stack.includes(unit_name)) {
      throw new IncludeError('recursive template expansion is not supported');
    }

    //Parse the template and store the resulting AST if it hasn't been parsed before
    if (!Object.hasOwn(templates[unit_name], 'ast')) {
      const parser = new Parser(templates[unit_name].text, unit_name);
      templates[unit_name].ast = parser.parse();
    }

    //Push the template into the stack and evaluate its AST with a new scope
    template_stack.push(unit_name);
    const result = evaluate(templates[unit_name].ast, new Scope(scope, globals));
    template_stack.pop();
    return result;
  },

  //Evaluate a <set_statement> AST object
  set_statement(statement, scope) {
    //Evaluate the expression first
    const value = evaluate(statement.expression, scope);

    //Set the identifier in the current scope
    scope.set(statement.identifier.name, value);

    return '';  //This is an internal logic operation with no output
  },

  //Evaluate a <for_statement> AST object
  for_statement(statement, scope) {
    //Evaluate the iterable first
    const iterable = evaluate(statement.iterable, scope);

    //Create a new child scope for the loop body
    const child_scope = new Scope(scope);

    //Evaluate the for statement based on the presence of the second loop variable
    if (!Object.hasOwn(statement, 'loop_var_2')) {
      //Single variable loop - Iterate and concatenate all iteration results into a single string
      return iterable.iterate(1).reduce((accumulator, loop_v1) => {
        //Set the loop variable in the child scope
        child_scope.set(statement.loop_var.name, loop_v1);

        //Evaluate the body with the child scope
        return accumulator + evaluate(statement.body, child_scope);
      }, '');
    }
    else {
      //Dual variable loop
      return iterable.iterate(2).reduce((accumulator, [loop_v1, loop_v2]) => {
        //Set the loop variables in the child scope
        child_scope.set(statement.loop_var.name, loop_v1);
        child_scope.set(statement.loop_var_2.name, loop_v2);

        //Evaluate the body with the child scope
        return accumulator + evaluate(statement.body, child_scope);
      }, '');
    }
  },

  //Evaluate an <expression_element> AST object
  expression_element(element, scope) {
    //The expression is first evaluated using the current scope and then registered with the
    //template builder, so it can be safely converted later to HTML, JSON, etc. based on context;
    //in the meantime a placeholder token is returned
    return template_builder.register_untrusted_value(element.location,
                                                     evaluate(element.expression, scope));
  },

  //Evaluate a <postfix_expression> AST object
  postfix_expression(expression, scope) {
    let lhs;
    let rhs;
    switch (expression.operator) {
      case '[]':
        lhs = evaluate(expression.lhs, scope);
        rhs = evaluate(expression.rhs, scope);
        return lhs.subscript_access(rhs);
      case '()':
        lhs = evaluate(expression.lhs, scope);
        rhs = expression.rhs.map(v => evaluate(v, scope));
        return lhs.call(...rhs);
      default:
        throw new EvaluationError(`operator "${expression.operator}" not implemented`);
    }
  },

  //Evaluate a <string_literal> AST object
  string_literal(literal, _scope) {
    return create_value(literal.value);
  },

  //Evaluate an <identifier> AST object
  identifier(identifier, scope) {
    return scope.get(identifier.name);
  },

  //Evaluate a <number_literal> AST object
  number_literal(literal, _scope) {
    return create_value(literal.value);
  }
};

//Evaluate an AST object using the given scope
function evaluate(ast_object, scope) {
  //Make sure there's an evaluator for the given AST object
  if (!Object.hasOwn(evaluator, ast_object.type)) {
    throw new Error(`No AST evaluator available for "${ast_object.type}" nodes`);
  }

  try {
    //Look up the evaluator and call it
    return evaluator[ast_object.type](ast_object, scope);
  }
  catch (error) {
    if (error instanceof EvaluationError) {
      //Add location information to any evaluation error
      throw new TemplateError(ast_object.location, error);
    }
    else {
      //Any other type of error has location information already or is unexpected - let it propagate
      throw error;
    }
  }
}

//Evaluate a new set of templates starting from the root unit name using the given global scope
//variables
export function evaluate_templates(new_templates, root_template, globals) {
  //Register all new templates locally
  Object.assign(templates, new_templates);

  //Kickstart the evaluation process by passing a passing a dummy <include_statement> AST object to
  //the corresponding evaluator function
  const html = evaluator.include_statement(
    {
      unit_name: {
        type: 'string_literal',
        value: root_template,
      },
    },
    null,
    globals
  );

  //Create and return a new document fragment from the evaluated HTML while performing safe
  //expansion of untrusted HTML strings
  return template_builder.expand_html(html);
}
