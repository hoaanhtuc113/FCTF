FROM ubuntu:24.04

RUN apt-get update
RUN apt-get install strace -y
RUN useradd -d /home/ctf/ -m -p ctf -s /bin/bash ctf
RUN echo "ctf:ctf" | chpasswd

WORKDIR /home/ctf

COPY pwn_1 .
COPY flag.txt .
COPY ynetd .
RUN chmod -R 755 /home/ctf


RUN chown -R root:root /home/ctf

USER ctf
EXPOSE 1200


CMD ./ynetd -p 1200 ./pwn_1
