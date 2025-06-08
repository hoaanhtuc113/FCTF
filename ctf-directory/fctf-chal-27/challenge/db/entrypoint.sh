#!/bin/bash
# Start SQL Server in background
/opt/mssql/bin/sqlservr &

# Wait for SQL Server to be ready
echo "Waiting for SQL Server..."
sleep 20

# Run your script
/opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P 'Dopii4720' -i /init/script.sql

# Keep container running
wait