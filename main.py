from fastapi import FastAPI
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from schema.book_name import book_valid
from schema.recommendation_response import BookResponse
from model.recommend import recommend_book,model,book_pivot
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"])


app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get('/')
def home():
    return FileResponse("static/index.html")


@app.get('/health')
def health():
    return{
        'Status' : 'Ok',
        'Model_loaded' : model is not None
    }

import traceback
import os

@app.get("/books")
def get_books():
    try:
        print("=== /books called ===")
        print("Current folder:", os.getcwd())
        print("Files here:", os.listdir("."))
        
        book_pivot
        print("Loaded df with shape:", book_pivot.shape)
        
        books = book_pivot.head(100).to_dict(orient="records")
        return {"status": "ok", "total": len(book_pivot), "books": books}
        
    except Exception as e:
        print("ERROR IN /books:", e)
        print(traceback.format_exc())
        return {"status": "error", "detail": str(e)}

@app.post('/predict', response_model=BookResponse)
def books_finder(book: book_valid):

    book_name = book.Book_name

    
    
    try:
        recommended_books = recommend_book(book_name)

        return JSONResponse(status_code=200, content={
            'recommendations' :recommended_books
            })

    except Exception as e:
        return JSONResponse(status_code=500, content=str(e))