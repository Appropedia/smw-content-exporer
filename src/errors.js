//Generic class for errors linked to a template source location
export class TemplateError extends Error {
  constructor(location, reason) {
    //If another error is passed as a reason use its message as the base for this one and include it
    //as a cause; otherwise just use the reason string as the message
    const message = reason instanceof Error? reason.message: reason;
    const options = reason instanceof Error? { cause: reason }: {};

    super(`${location.unit_name}:${location.line}:${location.column}: ${message}`, options);
    this.name = 'TemplateError';
  }
}

//Class for lexical errors
export class LexicalError extends TemplateError {
  constructor(location, message) {
    super(location, `lexical error: ${message}`);
    this.name = 'LexicalError';
  }
}

//Class for parse/syntax errors
export class ParseError extends TemplateError {
  constructor(location, message) {
    super(location, `syntax error: ${message}`);
    this.name = 'ParseError';
  }
}

//Class for template building errors
export class TemplateBuildError extends TemplateError {
  constructor(location, message) {
    super(location, `template build error: ${message}`);
    this.name = 'TemplateBuildError';
  }
}

//Base class for errors raised during expression evaluation
export class EvaluationError extends Error {
  name = 'EvaluationError';
}

//The classes below are for specific errors raised during expression evaluation

export class ScopeError extends EvaluationError {
  constructor(message) {
    super(`scope error: ${message}`);
    this.name = 'ScopeError';
  }
}

export class IncludeError extends EvaluationError {
  constructor(message) {
    super(`include error: ${message}`);
    this.name = 'IncludeError';
  }
}

export class IterateError extends EvaluationError {
  constructor(message) {
    super(`iterate error: ${message}`);
    this.name = 'IterateError';
  }
}

export class SubscriptAccessError extends EvaluationError {
  constructor(message) {
    super(`subscript access error: ${message}`);
    this.name = 'SubscriptAccessError';
  }
}

export class FunctionCallError extends EvaluationError {
  constructor(message) {
    super(`function call error: ${message}`);
    this.name = 'FunctionCallError';
  }
}
