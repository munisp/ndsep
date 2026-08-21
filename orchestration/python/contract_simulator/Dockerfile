FROM python:3.11-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.115.6 uvicorn==0.32.1 pydantic==2.10.3
COPY main.py ./main.py

EXPOSE 8346
USER nobody
CMD ["python", "main.py"]
