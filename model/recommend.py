import joblib
from fastapi import HTTPException
import pandas as pd
import numpy as np

model = joblib.load('model/book_recommender.pkl')

book_pivot = pd.read_csv('model/Datasets/book_set.csv')
book_pivot.set_index('title', inplace=True)


def recommend_book(book_name: str):

    if book_name not in book_pivot.index:
            raise HTTPException(status_code=404, detail=f"'{book_name}' Book  not found in the trained model data.")

    book_id = book_pivot.index.get_loc(book_name)
    distances, suggestions = model.kneighbors(book_pivot.iloc[book_id, :].values.reshape(1,-1), n_neighbors=6)
    
    recommended_books = []
    for i in range(len(suggestions[0])):
        if i == 0:
            continue
        else:
            recommended_books.append(book_pivot.index[suggestions[0][i]])


    return recommended_books
    