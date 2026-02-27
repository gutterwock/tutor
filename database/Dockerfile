FROM pgvector/pgvector:0.8.0-pg17

COPY schema.sql /docker-entrypoint-initdb.d/01-schema.sql

ENV POSTGRES_DB=rag
ENV POSTGRES_USER=rag
ENV POSTGRES_PASSWORD=rag
