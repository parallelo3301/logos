FROM denoland/deno:1.40.2

WORKDIR /app

RUN mkdir -p /app/data
RUN chown -R deno:deno /app

# Prefer not to run as root.
USER deno

# These steps will be re-run upon each file change in your working directory:
COPY main.ts .
# Compile the main app so that it doesn't need to be compiled each startup/entry.
RUN deno cache main.ts

CMD ["run", "--unstable-cron", "--allow-read=/app/.env,/app/.env.defaults,/app/.env.example,/app/data/logosdb.sqlite,/app/data/logosdb.sqlite-journal", "--allow-write=/app/data/logosdb.sqlite,/app/data/logosdb.sqlite-journal", "--allow-net=0.0.0.0", "--allow-env=PORT,DB_FILE,PUBLIC_URL,MAX_FILE_SIZE_BYTES,DEFAULT_EXPIRATION_MINUTES", "main.ts"]
