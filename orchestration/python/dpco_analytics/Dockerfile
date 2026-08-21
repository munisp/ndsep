FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn pydantic requests kafka-python redis pyarrow boto3
COPY . .
EXPOSE 8330
USER nobody
CMD ["python", "service.py"]
