import { LexicalAnalyzer } from './lexical-analyzer.js';
import { ParseError } from './errors.js';

//Parser for the template language
export class Parser {
  #lexer;   //Local lexical analyzer instance

  constructor(template, unit_name) {
    this.#lexer = new LexicalAnalyzer(template, unit_name);
  }

  //Public function used to peform the recursive parsing process
  parse() {
    return this.#parse_template([]);
  }

  //Words reserved for the template language
  #reserved_words = [
    'elif', 'else', 'end', 'False', 'for', 'if', 'in', 'include', 'not', 'set', 'True'
  ];

  //The parsed language in Backus-Naur Form is as follows:
  //  <template> ::= <template_element> <template>
  //               | <empty>
  //
  //  <template_element> ::= <statement_element>
  //                       | <expression_element>
  //                       | <raw_text_element>
  //
  //  <statement_element> ::= <include_statement>
  //                       |  <set_statement>
  //                       |  <if_statement>
  //                       |  <for_statement>
  //
  //  <include_statement> ::= {% include <expression> %}
  //
  //  <set_statement> ::= {% set <identifier> = <expression> %}
  //
  //  <if_statement> ::= <if_delimiter> <template> <elif_branches> <else_branch> <end_delimiter>
  //
  //  <elif_branches> ::= <elif_delimiter> <template> <elif_branches>
  //                    | <empty>
  //
  //  <else_branch> ::= <else_delimiter> <template>
  //                  | <empty>
  //
  //  <if_delimiter> ::= {% if <expression> %}
  //
  //  <elif_delimiter> ::= {% elif <expression> %}
  //
  //  <else_delimiter> ::= {% else %}
  //
  //  <for_statement> ::= <for_delimiter> <template> <end_delimiter>
  //
  //  <for_delimiter> ::= {% for <identifier> in <expression> %}
  //                    | {% for <identifier> , <identifier> in <expression> %}
  //
  //  <end_delimiter> ::= {% end %}
  //
  //  <expression_element> ::= {{ <expression> }}
  //
  //  <expression> ::= <comparison_expression>
  //
  //  <comparison_expression> ::= <primary_expression>
  //                            | <comparison_expression> in <primary_expression>
  //                            | <comparison_expression> not in <primary_expression>
  //
  //  <primary_expression> ::= <atom_expression>
  //                         | <primary_expression> [ <expression> ]
  //                         | <primary_expression> ( <argument_list> )
  //
  //  <atom_expression> ::= <string_literal>
  //                      | <number_literal>
  //                      | <bool_literal>
  //                      | <identifier>
  //
  //  <argument_list> ::= <expression_list>
  //                    | <empty>
  //
  //  <expression_list> ::= <expression>
  //                      | <expression_list> , <expression>
  //
  //  <string_literal> ::= ' <string_text> '
  //                     | " <string_text> "
  //
  //  <bool_literal> ::= True
  //                   | False
  //
  //The following nonterminal symbols are described using natural language for convenience and are
  //implemented in the lexical analyzer where applicable:
  //  <empty>: Indicates the absence of a symbol
  //
  //  <raw_text_element>: Any text that does not include any braces: {% %} {{ }}
  //
  //  <number_literal>: Any valid number
  //
  //  <identifier>: Any valid name that matches this regex: [a-zA-Z_][a-zA-Z_0-9]*
  //
  //  <string_text>: Any text that does not include the enclosing single or double quotes unless
  //                 escaped
  //
  //Notes:
  //- The <expression> non terminal symbol exists as a top-level expression placeholder that can be
  //  modified if lower precedence operators are added to the language

  //The functions below implement each of the rules mentioned above
  //------------------------------------------------------------------------------------------------

  //Parse a <template> nonterminal symbol
  //Parameters:
  //- closing_tokens: Array of strings indicating which delimiters can complete this nonterminal
  //  symbol (e.g. "for" is finished by "end")
  //BNF:
  //  <template> ::= <template_element> <template>
  //               | <empty>
  #parse_template(closing_tokens) {
    //Start with an empty template
    const ast = {
      type: 'template',
      elements: [],
    };

    //Append template elements until reaching end of input
    while (this.#lexer.peek() !== undefined) {
      const template_element = this.#parse_template_element(closing_tokens);

      if (template_element === undefined) {
        //A closing token was found, finish the process now
        break;
      }

      ast.elements.push(template_element);
    }

    return ast;
  }

  //Parse a <template_element> nonterminal symbol
  //Parameters:
  //- closing_tokens: Array of strings indicating which delimiters can complete this nonterminal
  //  symbol (e.g. "for" is finished by "end")
  //BNF:
  //  <template_element> ::= <statement_element>
  //                       | <expression_element>
  //                       | <raw_text_element>
  #parse_template_element(closing_tokens) {
    //This is a LL(2) parser, look at the first token that follows to check which element comes next
    const token = this.#lexer.peek(0);
    switch (token.value) {
      case '{%':
        return this.#parse_statement_element(closing_tokens);
      case '{{':
        return this.#parse_expression_element();
      default:
        this.#lexer.consume();
        return {
          type: 'raw_text_element',
          raw_text: token.value,
        };
    }
  }

  //Parse a <statement_element> nonterminal symbol
  //Parameters:
  //- closing_tokens: Array of strings indicating which delimiters can complete this nonterminal
  //  symbol (e.g. "for" is finished by "end")
  //BNF:
  //  <statement_element> ::= <include_statement>
  //                       |  <set_statement>
  //                       |  <if_statement>
  //                       |  <for_statement>
  #parse_statement_element(closing_tokens) {
    //This is a LL(2) parser, look at the second token that follows to check which statement comes
    //next
    const token = this.#lexer.peek(1, 'statement keyword');

    switch (token.value) {
      case 'include':
        return this.#parse_include_statement();
      case 'set':
        return this.#parse_set_statement();
      case 'if':
        return this.#parse_if_statement();
      case 'for':
        return this.#parse_for_statement();
      default:
        //No statement found, check for valid closing tokens
        if (closing_tokens.includes(token.value)) {
          //Valid closing token found, signal this by returning undefined instead of an AST object
          return undefined;
        }
        else {
          //Not a valid closing token, check for known keywords
          switch (token.value) {
            case 'elif':
            case 'else':
            case 'end':
              throw new ParseError(token.location, `stray "${token.value}" found`);
            default:
              throw new ParseError(token.location, `invalid statement keyword: "${token.value}"`);
          }
        }
    }
  }

  //Parse an <include_statement> nonterminal symbol
  //BNF:
  //  <include_statement> ::= {% include <expression> %}
  #parse_include_statement() {
    const location = this.#lexer.peek().location;
    this.#lexer.consume('{%');
    this.#lexer.consume('include');
    const unit_name = this.#parse_expression();
    this.#lexer.consume('%}');

    return {
      type: 'include_statement',
      location: location,
      unit_name: unit_name,
    };
  }

  //Parse a <set_statement> nonterminal symbol
  //BNF:
  //  <set_statement> ::= {% set <identifier> = <expression> %}
  #parse_set_statement() {
    this.#lexer.consume('{%');
    this.#lexer.consume('set');
    const identifier = this.#parse_identifier();
    this.#lexer.consume('=');
    const expression = this.#parse_expression();
    this.#lexer.consume('%}');

    return {
      type: 'set_statement',
      identifier: identifier,
      expression: expression,
    };
  }

  //Parse an <if_statement> nonterminal symbol
  //BNF:
  //  <if_statement> ::= <if_delimiter> <template> <elif_branches> <else_branch> <end_delimiter>
  #parse_if_statement() {
    const branches = [
      {
        location: this.#lexer.peek().location,
        condition: this.#parse_if_delimiter(),
        body: this.#parse_template(['elif', 'else', 'end']),
      },
      ...this.#parse_elif_branches(),
      ...this.#parse_else_branch(),
    ];
    this.#parse_end_delimiter();

    return {
      type: 'if_statement',
      branches: branches,
    };
  }

  //Parse an <elif_branches> nonterminal symbol
  //BNF:
  //  <elif_branches> ::= <elif_delimiter> <template> <elif_branches>
  //                    | <empty>
  #parse_elif_branches() {
    const branches = [];

    //This is a LL(2) parser, look at the two tokens that follow for additional elif tokens on each
    //iteration, and keep appending them until no more are found
    let token;
    while ((token = this.#lexer.peek(0))?.value === '{%' && this.#lexer.peek(1)?.value === 'elif') {
      branches.push({
        location: token.location,
        condition: this.#parse_elif_delimiter(),
        body: this.#parse_template(['elif', 'else', 'end']),
      });
    }

    return branches;
  }

  //Parse an <else_branch> nonterminal symbol
  //BNF:
  //  <else_branch> ::= <else_delimiter> <template>
  //                  | <empty>
  #parse_else_branch() {
    const branch = [];

    if (this.#lexer.peek(0)?.value === '{%' && this.#lexer.peek(1)?.value === 'else') {
      this.#parse_else_delimiter();
      branch.push({
        body: this.#parse_template(['end']),
      });
    }

    return branch;
  }

  //Parse an <if_delimiter> nonterminal symbol
  //BNF:
  //  <if_delimiter> ::= {% if <expression> %}
  #parse_if_delimiter() {
    this.#lexer.consume('{%');
    this.#lexer.consume('if');
    const condition = this.#parse_expression();
    this.#lexer.consume('%}');

    return condition;
  }

  //Parse an <elif_delimiter> nonterminal symbol
  //BNF:
  //  <elif_delimiter> ::= {% elif <expression> %}
  #parse_elif_delimiter() {
    this.#lexer.consume('{%');
    this.#lexer.consume('elif');
    const condition = this.#parse_expression();
    this.#lexer.consume('%}');

    return condition;
  }

  //Parse an <else_delimiter> nonterminal symbol
  //BNF:
  //  <else_delimiter> ::= {% else %}
  #parse_else_delimiter() {
    this.#lexer.consume('{%');
    this.#lexer.consume('else');
    this.#lexer.consume('%}');
  }

  //Parse a <for_statement> nonterminal symbol
  //BNF:
  //  <for_statement> ::= <for_delimiter> <template> <end_delimiter>
  #parse_for_statement() {
    const location = this.#lexer.peek().location;
    const delimiter = this.#parse_for_delimiter();
    const body = this.#parse_template(['end']);
    this.#parse_end_delimiter();

    return {
      type: 'for_statement',
      location: location,
      loop_var: delimiter.loop_var,
      ...Object.hasOwn(delimiter, 'loop_var_2')? { loop_var_2: delimiter.loop_var_2 }: {},
      iterable: delimiter.iterable,
      body: body,
    };
  }

  //Parse a <for_delimiter> nonterminal symbol
  //BNF:
  //  <for_delimiter> ::= {% for <identifier> in <expression> %}
  //                    | {% for <identifier> , <identifier> in <expression> %}
  #parse_for_delimiter() {
    this.#lexer.consume('{%');
    this.#lexer.consume('for');
    const loop_var = this.#parse_identifier();

    let loop_var_2 = undefined;
    if (this.#lexer.peek(0, '"," or "in"').value === ',') {
      this.#lexer.consume();
      loop_var_2 = this.#parse_identifier();
    }

    this.#lexer.consume('in');
    const iterable = this.#parse_expression(this.#lexer);
    this.#lexer.consume('%}');

    return {
      loop_var: loop_var,
      ...loop_var_2 !== undefined? { loop_var_2: loop_var_2 }: {},
      iterable: iterable,
    };
  }

  //Parse an <end_delimiter> nonterminal symbol
  //BNF:
  //  <end_delimiter> ::= {% end %}
  #parse_end_delimiter() {
    this.#lexer.consume('{%');
    this.#lexer.consume('end');
    this.#lexer.consume('%}');
  }

  //Parse an <expression_element> nonterminal symbol
  //BNF:
  //  <expression_element> ::= {{ <expression> }}
  #parse_expression_element() {
    const location = this.#lexer.peek().location;
    this.#lexer.consume('{{');
    const expression = this.#parse_expression();
    this.#lexer.consume('}}');

    return {
      type: 'expression_element',
      location: location,
      expression: expression,
    };
  }

  //Parse an <expression> nonterminal symbol
  //BNF:
  //  <expression> ::= <comparison_expression>
  #parse_expression() {
    return this.#parse_comparison_expression();
  }

  //Parse a <comparison_expression> nonterminal symbol
  //BNF:
  //  <comparison_expression> ::= <primary_expression>
  //                            | <comparison_expression> in <primary_expression>
  //                            | <comparison_expression> not in <primary_expression>
  #parse_comparison_expression() {
    //Start by parsing the first left-hand subexpression as a primary expression
    let result = this.#parse_primary_expression();

    //Handle left-to-right associativity by iterating until no more infix operators are found; each
    //comparison expression wraps its previous left-hand comparison expression in its result,
    //enforcing the correct evaluation order
    let infix_operator_token;
    loop: while ((infix_operator_token = this.#lexer.peek()) !== undefined) {
      switch (infix_operator_token.value) {
        case 'in': {
          this.#lexer.consume();
          result = {
            type: 'comparison_expression',
            location: infix_operator_token.location,
            operator: 'in',
            lhs: result,
            rhs: this.#parse_primary_expression(),
          };
          break;
        }
        case 'not': {
          this.#lexer.consume();
          this.#lexer.consume('in');
          result = {
            type: 'comparison_expression',
            location: infix_operator_token.location,
            operator: 'not in',
            lhs: result,
            rhs: this.#parse_primary_expression(),
          };
          break;
        }
        default: {
          break loop;
        }
      }
    }

    return result;
  }

  //Parse a <primary_expression> nonterminal symbol
  //BNF:
  //  <primary_expression> ::= <atom_expression>
  //                         | <primary_expression> [ <expression> ]
  //                         | <primary_expression> ( <argument_list> )
  #parse_primary_expression() {
    //Start by parsing the first left-hand subexpression as an atom expression
    let result = this.#parse_atom_expression();

    //Handle left-to-right associativity by iterating until no more postfix operators are found;
    //each primary expression wraps its previous left-hand primary expression in its result,
    //enforcing the correct evaluation order
    let postfix_operator_token;
    loop: while ((postfix_operator_token = this.#lexer.peek()) !== undefined) {
      switch (postfix_operator_token.value) {
        case '[':
          this.#lexer.consume();
          result = {
            type: 'primary_expression',
            location: postfix_operator_token.location,
            operator: '[]',
            lhs: result,
            rhs: this.#parse_expression(),
          };
          this.#lexer.consume(']');
          break;
        case '(':
          this.#lexer.consume();
          result = {
            type: 'primary_expression',
            location: postfix_operator_token.location,
            operator: '()',
            lhs: result,
            rhs: this.#parse_argument_list(),
          };
          this.#lexer.consume(')');
          break;
        default:
          break loop;
      }
    }

    return result;
  }

  //Parse an <atom_expression> nonterminal symbol
  //BNF:
  //  <atom_expression> ::= <string_literal>
  //                      | <number_literal>
  //                      | <bool_literal>
  //                      | <identifier>
  #parse_atom_expression() {
    const token = this.#lexer.peek(0, 'atom expression');

    if (['\'', '"'].includes(token.value)) {
      return this.#parse_string_literal();
    }
    else if (/^[0-9.]/.test(token.value)) {
      return this.#parse_number_literal();
    }
    else if (['True', 'False'].includes(token.value)) {
      return this.#parse_bool_literal();
    }
    else {
      return this.#parse_identifier();
    }
  }

  //Parse an <argument_list> nonterminal symbol
  //BNF:
  //  <argument_list> ::= <expression_list>
  //                    | <empty>
  //
  //  <expression_list> ::= <expression>
  //                      | <expression_list> , <expression>
  #parse_argument_list() {
    const expressions = [];

    //Return immediately if the argument list is empty
    if (this.#lexer.peek(0, 'expression or ")"').value === ')') {
      return expressions;
    }

    //Parse the first expression
    expressions.push(this.#parse_expression());

    //Parse every other expression that may follow
    while (this.#lexer.peek(0, '"," or ")"').value === ',') {
      this.#lexer.consume();
      expressions.push(this.#parse_expression());
    }

    return expressions;
  }

  //Parse a <string_literal> nonterminal symbol
  //BNF:
  //  <string_literal> ::= ' <string_text> '
  //                     | " <string_text> "
  #parse_string_literal() {
    const token = this.#lexer.peek(0, 'string literal');

    let string_text_token;
    switch (token.value) {
      case '\'':
        this.#lexer.consume();
        string_text_token = this.#lexer.peek(0, 'string text');
        this.#lexer.consume();
        this.#lexer.consume('\'');
        break;
      case '"':
        this.#lexer.consume();
        string_text_token = this.#lexer.peek(0, 'string text');
        this.#lexer.consume();
        this.#lexer.consume('"');
        break;
      default:
        throw new ParseError(token.location,
                             `expected string literal but found "${token.value}" instead`);
    }

    return {
      type: 'string_literal',
      value: string_text_token.value,
    };
  }

  //Parse a <bool_literal> nonterminal symbol
  //BNF:
  //  <bool_literal> ::= True
  //                   | False
  #parse_bool_literal() {
    const token = this.#lexer.peek(0, 'bool literal');

    let value;
    switch (token.value) {
      case 'True':
        this.#lexer.consume();
        value = true;
        break;
      case 'False':
        this.#lexer.consume();
        value = false;
        break;
      default:
        throw new ParseError(token.location,
                             `expected bool literal but found "${token.value}" instead`);
    }

    return {
      type: 'bool_literal',
      value: value,
    };
  }

  //Parse a <number_literal> nonterminal symbol
  #parse_number_literal() {
    const token = this.#lexer.peek(0, 'number literal');
    this.#lexer.consume();

    return {
      type: 'number_literal',
      value: Number(token.value),
    };
  }

  //Parse an <identifier> nonterminal symbol
  #parse_identifier() {
    const token = this.#lexer.peek(0, 'identifier');

    //Make sure the identifier uses the correct characters
    if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(token.value)) {
      throw new ParseError(token.location, `invalid identifier: "${token.value}" - must only ` +
                           'contain letters, numbers and underscores and cannot start with a ' +
                           'number');
    }

    //Also make sure the identifier is not a reseved word
    if (this.#reserved_words.includes(token.value)) {
      throw new ParseError(token.location, `unexpected reserved word: "${token.value}"`);
    }

    this.#lexer.consume();

    return {
      type: 'identifier',
      location: token.location,
      name: token.value,
    };
  }
}
