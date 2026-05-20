import pandas as pd
import numpy as np
import pickle
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
import os

def train_model():
    print("Loading data...")
    # Get the directory of the current script
    current_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(current_dir, 'mock_data.csv')
    
    try:
        df = pd.read_csv(data_path)
    except FileNotFoundError:
        print(f"Error: Could not find {data_path}")
        return

    # Basic preprocessing: handle missing values just in case
    df = df.dropna(subset=['text', 'label'])
    
    X = df['text']
    y = df['label']

    # Vectorize text using word pairs too; fake claims often depend on short phrases
    # like "miracle cure", "false claim", or "no evidence".
    print("Vectorizing text...")
    vectorizer = TfidfVectorizer(
        stop_words='english',
        max_df=0.85,
        min_df=1,
        ngram_range=(1, 2),
        sublinear_tf=True,
    )
    X_vectorized = vectorizer.fit_transform(X)

    X_train, X_test, y_train, y_test = train_test_split(
        X_vectorized,
        y,
        test_size=0.25,
        random_state=42,
        stratify=y,
    )

    # Initialize and train Logistic Regression model
    print("Training Logistic Regression model...")
    model = LogisticRegression(random_state=42, max_iter=1000, class_weight='balanced')
    model.fit(X_train, y_train)

    # Evaluate the model
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"Model Accuracy on Test Set: {accuracy * 100:.2f}%")

    # Save the model and vectorizer
    model_path = os.path.join(current_dir, 'model.pkl')
    vectorizer_path = os.path.join(current_dir, 'vectorizer.pkl')
    
    print(f"Saving model to {model_path}...")
    with open(model_path, 'wb') as f:
        pickle.dump(model, f)
        
    print(f"Saving vectorizer to {vectorizer_path}...")
    with open(vectorizer_path, 'wb') as f:
        pickle.dump(vectorizer, f)
        
    print("Training complete!")

if __name__ == "__main__":
    train_model()
