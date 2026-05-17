type RequestContext = { accessReason?: string | null };

let _requestContext: RequestContext = { accessReason: null };

export function setRequestContext(next: RequestContext): void {
  _requestContext = { ..._requestContext, ...next };
}

export function getRequestContext(): RequestContext {
  return _requestContext;
}
