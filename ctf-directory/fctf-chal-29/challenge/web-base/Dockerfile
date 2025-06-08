

FROM mcr.microsoft.com/dotnet/aspnet:6.0 AS runtime
WORKDIR /app

COPY . .

EXPOSE 80

ENTRYPOINT ["dotnet", "SecathonWebApp.dll"]