import socket
import time

def test_socket_client():
    client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_address = ('127.0.0.1', 5000)
    
    try:
        client_socket.connect(server_address)
        print("Connected to server")

        # Vòng lặp gửi và nhận thông điệp
        while True:
            message = input("Enter message to send (or 'exit' to quit): ")
            if message.lower() == 'exit':
                break

            client_socket.sendall(message.encode())
            print(f"Sent: {message}")

            # Nhận phản hồi từ server
            response = client_socket.recv(1024).decode()
            print(f"Received: {response}")

    except Exception as e:
        print(f"Error: {e}")
    finally:
        client_socket.close()
        print("Connection closed")

if __name__ == "__main__":
    test_socket_client()

