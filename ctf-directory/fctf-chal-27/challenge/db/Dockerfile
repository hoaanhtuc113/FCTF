FROM mcr.microsoft.com/mssql/server:2019-latest

ENV ACCEPT_EULA=Y
ENV SA_PASSWORD=Dopii4720

COPY script.sql /init/script.sql
COPY entrypoint.sh /init/entrypoint.sh
RUN chmod +x /init/entrypoint.sh

ENTRYPOINT ["/bin/bash", "/init/entrypoint.sh"]