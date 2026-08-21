FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn pydantic
COPY . .
EXPOSE 8200 8210 8220
USER nobody
CMD ["python", "service.py"]
