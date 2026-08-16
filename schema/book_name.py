from pydantic import BaseModel, Field
from typing import Annotated, List


class book_valid(BaseModel):
    Book_name : Annotated[str, Field(..., description='Book Name')]
