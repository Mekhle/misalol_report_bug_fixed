from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = (
            request.headers.get("x-request-id")
            or request.headers.get("cf-ray")
            or uuid4().hex
        )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
