FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn pydantic requests kafka-python redis
COPY . .
EXPOSE 8340
USER nobody
CMD ["python", "service.py"]
