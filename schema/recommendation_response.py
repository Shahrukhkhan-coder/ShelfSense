from pydantic import BaseModel, Field
from typing import Annotated, List


class BookResponse(BaseModel):
    recommendations: List[str]
