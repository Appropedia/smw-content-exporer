import { LexicalError, ParseError } from './errors.js';

//Lexical analyzer for templates
export class LexicalAnalyzer {
  #unit_name;           //The current lexical analyzer unit (e.g. template filename)
  #token_generator;     //Generates tokens for peeking and/or consuming
  #token_buffer = [];   //Stores the next tokens so that peeking further ahead is possible
  #current_line = 1;    //Used by the token generator to track line and column positions
  #current_column = 1;

  constructor(template, unit_name) {
    this.#unit_name = unit_name;
    this.#token_generator = this.#token_generator_function(template);
  }

  //Retrieve a future token at a given offset without consuming it
  //Parameters:
  //- n: The token offset
  //- token_description (optional):
  //  - If defined: Throw an exception upon end of input and use this description in the message
  //  - If undefined: Throw no exception upon end of input and return undefined instead
  peek(n = 0, token_description) {
    //Make sure the token buffer is filled up to the requested position
    while (this.#token_buffer.length <= n) {
      //Get the next token from the generator
      const { value: token, done } = this.#token_generator.next();

      //Handle end of input
      if (done) {
        if (token_description !== undefined) {
          throw new ParseError(this.#tok_gen_location(), `expected ${token_description} but ` +
                               'encountered end of template instead');
        }
        else {
          return undefined;
        }
      }

      //Add the token to the buffer
      this.#token_buffer.push(token);
    }

    return this.#token_buffer[n];
  }

  //Consume a token and optionally check its value
  //Parameters:
  //- expected_value (optional):
  //  - If defined: Compare the token value upon consuming and throw an error on a mismatch
  //  - If undefined: Perform no comparison upon consuming
  consume(expected_value) {
    let next_token;

    //Check whether the token buffer is empty
    if (this.#token_buffer.length > 0) {
      //The buffer is not empty, take the next token from it
      next_token = this.#token_buffer.shift();
    }
    else {
      //The buffer is empty, take the next token from the generator instead
      const { value: token, done } = this.#token_generator.next();

      //Handle end of input
      if (done) {
        const description = expected_value !== undefined? `"${expected_value}"`: 'a token';
        throw new ParseError(this.#tok_gen_location(),
                             `expected ${description} but encountered end of template instead`);
      }

      next_token = token;
    }

    //Optionally check the value and throw an error on a mismatch
    if (expected_value !== undefined && next_token.value !== expected_value) {
      throw new ParseError(next_token.location, `expected "${expected_value}" but encountered ` +
                           `"${next_token.value}" instead`);
    }
  }

  //Format the current token generator location as a string
  #tok_gen_location() {
    return { unit_name: this.#unit_name, line: this.#current_line, column: this.#current_column };
  }

  //Internal function used to generate tokens from the input text
  *#token_generator_function(template) {
    //Possible lexical analyzer states
    const State = Object.freeze({
      raw_text: 0,              //Input is raw text (HTML)
      statement: 1,             //Input is a statement enclosed between "{%" and "%}"
      expression: 2,            //Input is an expression enclosed between "{{" and "}}"
      single_quoted_string: 3,  //Input is a string in single quotes ''
      double_quoted_string: 4,  //Input is a string in double quotes ''
    });

    //Regex used for scanning raw text, captures any opening/closing brace or comment
    const raw_text_regex = /{%|%}|{{|}}|<!--[\s\S]*?-->/g;

    //Regex used for scanning code text that can be present in statements and expressions
    const code_text_regex = new RegExp(
      [
        ['word', '[a-zA-Z_][a-zA-Z_0-9]*'],                                   //Keyword/identifier
        ['number', '(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?'], //Number literal
        ['string_literal', '[\'"]'],                                          //String literal
        ['special', '[\\[\\]\\(\\),=]'],                                      //Special characters
        ['delimiter_brace', '{%|%}|{{|}}'],                                   //Any deliminter brace
        ['space', '\\s+'],                                                    //Whitespace
        ['invalid', '.'],                                                     //Any other character
      ].map(([name, exp]) => `(?<${name}>${exp})`).join('|'),
      'g'
    );

    //Regexes used for scanning single and double quoted strings; both look for their non-escaped
    //closing counterpart, taking into account potential multiple backslashes so that the closing
    //quote can only be preceded by an even amount of them (odd amounts are excluded)
    const string_regex = {
      [State.single_quoted_string]: /(?<=(?<!\\)(?:\\\\)*)'/g,
      [State.double_quoted_string]: /(?<=(?<!\\)(?:\\\\)*)"/g,
    };

    //Variables for tracking current and previous lexical analyzer states
    let s = State.raw_text;
    const state_stack = [];

    //Short helpers for handling state transitions
    function state_enter(new_state) { state_stack.push(s); s = new_state; }
    function state_exit() { s = state_stack.pop(); }

    let index = 0;  //Current position in the template string
    let match;      //Current regex match

    loop: while (index < template.length) {
      switch (s) {
        case State.raw_text: {
          //Set the starting position of the corresponding regex and look for the next token
          raw_text_regex.lastIndex = index;
          match = raw_text_regex.exec(template);

          if (match === null) {
            //No more brace tokens found, yield the rest of the template as raw text
            yield { value: template.slice(index), location: this.#tok_gen_location() };
            break loop;
          }

          if (match.index > index) {
            //Yield the raw text before the next match and update the current location
            const raw_text = template.slice(index, match.index);
            yield { value: raw_text, location: this.#tok_gen_location() };
            this.#count_lines_and_columns(raw_text);
          }

          //Transition into the new state based on the next token
          switch (match[0]) {
            case '{%':
              //Statement opening brace found - yield it and transition into the statement state
              yield { value: match[0], location: this.#tok_gen_location() };
              state_enter(State.statement);
              break;
            case '{{':
              //Expression opening brace found - yield it and transition into the expression state
              yield { value: match[0], location: this.#tok_gen_location() };
              state_enter(State.expression);
              break;
            case '%}':
            case '}}':
              //Closing brace found during wrong state
              throw new ParseError(this.#tok_gen_location(),
                                   `closing "${match[0]}" without matching opening brace`);
            default:
              //Comment found - yield it directly
              yield { value: match[0], location: this.#tok_gen_location() };
              this.#count_lines_and_columns(match[0]);
              break;
          }

          //Update the current location and store the last position of the regex in preparation for
          //the next state
          this.#current_column += match[0].length;
          index = raw_text_regex.lastIndex;
          break;
        }
        case State.statement:
        case State.expression: {
          //Set the starting position of the corresponding regex and look for the next token
          code_text_regex.lastIndex = index;
          match = code_text_regex.exec(template);
          //Note: the match result is never null due to how the regex is constructed

          //Filter the match groups to obtain the applicable group, then destructure it
          const [[group, value]] = Object.entries(match.groups).filter(([_, v]) => v !== undefined);

          switch (group) {
            case 'word':
            case 'special':
              //Words and special characters are yieled directly
              yield { value: value, location: this.#tok_gen_location() };
              this.#current_column += value.length;
              break;
            case 'number':
              //Disallow trailing word characters and some number characters as well (this regex
              //should detect most if not all malformed number sequences)
              match = /^[a-zA-Z_0-9.]+/g.exec(template.slice(code_text_regex.lastIndex));
              //Note: Digits are consumed greedily by the initial regular expression for numbers,
              //but they are also included here in case they come after a non-digit character
              if (match !== null) {
                throw new LexicalError(this.#tok_gen_location(),
                                       `trailing "${match[0]}" after number literal`);
              }

              yield { value: value, location: this.#tok_gen_location() };
              this.#current_column += value.length;
              break;
            case 'string_literal':
              //String opening quotes are yielded directly but cause a state transition
              yield { value: value, location: this.#tok_gen_location() };
              this.#current_column += value.length;
              state_enter(value === '\''? State.single_quoted_string: State.double_quoted_string);
              break;
            case 'delimiter_brace':
              //Make sure the delimiter brace corresponds to the current lexer state before yielding
              if ((s === State.statement && value === '%}') ||
                  (s === State.expression && value === '}}'))
              {
                yield { value: value, location: this.#tok_gen_location() };
                this.#current_column += value.length;
                state_exit();
              }
              else {
                //Wrong opening/closing brace found during wrong state
                throw new ParseError(this.#tok_gen_location(), `unexpected "${value}" brace found`);
              }
              break;
            case 'space':
              //Spaces are simply counted
              this.#count_lines_and_columns(value);
              break;
            case 'invalid':
              throw new LexicalError(this.#tok_gen_location(), `unexpected "${value}" found`);
          }

          //Store the last position of the regex in preparation for the next iteration/state
          index = code_text_regex.lastIndex;
          break;
        }
        case State.single_quoted_string:
        case State.double_quoted_string: {
          //Set the starting position of the corresponding regex and look for the next token
          string_regex[s].lastIndex = index;
          match = string_regex[s].exec(template);

          if (match === null) {
            //No matching closing quote found
            throw new LexicalError(this.#tok_gen_location(), 'unterminated string literal');
          }

          //Get the raw string text (if any) before the next match
          const raw_text = template.slice(index, match.index);

          //Replace string escape sequences (only basic support for now)
          const string_text = raw_text.replace(/\\(["'\\])/g, '$1');

          //Now yield the escaped string text and update the current location
          yield { value: string_text, location: this.#tok_gen_location() };
          this.#count_lines_and_columns(string_text);

          //Yield the closing quote character and update the current location as well
          yield { value: match[0], location: this.#tok_gen_location() };
          this.#current_column += match[0].length;

          //Store the last position of the regex and transition to the previous state
          index = string_regex[s].lastIndex;
          state_exit();
          break;
        }
      }
    }
  }

  //Count the lines and colums contained in a string and advance the current position accordingly
  #count_lines_and_columns(str) {
    //Update the current line by counting the line endings contained in the string
    const line_count = (str.match(/\n/g) ?? []).length;
    this.#current_line += line_count;

    //Update the current column based on the outcome of the previous operation
    if (line_count > 0) {
      //At least one new line was found, set the column count to the length of the last line in the
      //string plus 1
      this.#current_column = str.match(/[^\n]*$/)[0].length + 1;
      //Note: the match result is never null due to how the regex is constructed
    }
    else {
      //No new lines found, simply advance the current column
      this.#current_column += str.length;
    }
  }
}
