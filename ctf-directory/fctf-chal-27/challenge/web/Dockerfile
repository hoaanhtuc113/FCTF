FROM tomcat:9.0

# Xoá ứng dụng mặc định (optional)
RUN rm -rf /usr/local/tomcat/webapps/*

# Copy file WAR vào thư mục webapps
COPY app.war /usr/local/tomcat/webapps/app.war

EXPOSE 8080