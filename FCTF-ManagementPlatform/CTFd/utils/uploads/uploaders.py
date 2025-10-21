import datetime
import os
import posixpath
import string
import time
from pathlib import Path, PurePath
from shutil import copyfileobj, rmtree
from urllib.parse import urlparse

import boto3
from botocore.client import Config
from flask import current_app, redirect, send_file
from freezegun import freeze_time
from werkzeug.utils import safe_join, secure_filename

from CTFd.utils import get_app_config
from CTFd.utils.encoding import hexencode
import json
import ssl
import http.client


class BaseUploader(object):
    def __init__(self):
        """
        Initialize the uploader with any required information
        """
        raise NotImplementedError

    def store(self, fileobj, filename):
        """
        Directly store a file object at the specified filename
        """
        raise NotImplementedError

    def upload(self, file_obj, filename):
        """
        Upload a file while handling any security protections or file renaming
        """
        raise NotImplementedError

    def download(self, filename):
        """
        Generate a Flask response to download the requested file
        """
        raise NotImplementedError

    def delete(self, filename):
        """
        Delete an uploaded file from the file store
        """
        raise NotImplementedError

    def sync(self):
        """
        Download all remotely hosted files for the purpose of exporting
        """
        raise NotImplementedError

    def open(self, mode="rb"):
        """
        Return a file pointer for an uploaded file.
        In the case of remotely hosted files, download the target file and then
        return the file pointer for the local copy.
        """
        raise NotImplementedError


class FilesystemUploader(BaseUploader):
    def __init__(self, base_path=None):
        super(BaseUploader, self).__init__()
        self.base_path = base_path or current_app.config.get("UPLOAD_FOLDER")

    def store(self, fileobj, filename):
        location = os.path.join(self.base_path, filename)
        directory = os.path.dirname(location)

        if not os.path.exists(directory):
            os.makedirs(directory)

        with open(location, "wb") as dst:
            copyfileobj(fileobj, dst, 16384)

        return filename

    def upload(self, file_obj, filename, path=None):
        if len(filename) == 0:
            raise Exception("Empty filenames cannot be used")

        # Sanitize directory name
        if path:
            path = secure_filename(path) or hexencode(os.urandom(16))
            path = path.replace(".", "")
        else:
            path = hexencode(os.urandom(16))

        # Sanitize file name
        filename = secure_filename(filename)
        file_path = posixpath.join(path, filename)

        return self.store(file_obj, file_path)

    def download(self, filename):
        return send_file(safe_join(self.base_path, filename), as_attachment=True)

    def delete(self, filename):
        if os.path.exists(os.path.join(self.base_path, filename)):
            file_path = PurePath(filename).parts[0]
            rmtree(os.path.join(self.base_path, file_path))
            return True
        return False

    def sync(self):
        pass

    def open(self, filename, mode="rb"):
        path = Path(safe_join(self.base_path, filename))
        return path.open(mode=mode)


class S3Uploader(BaseUploader):
    def __init__(self):
        super(BaseUploader, self).__init__()
        self.s3 = self._get_s3_connection()
        self.bucket = get_app_config("AWS_S3_BUCKET")
        # If the custom prefix is provided, add a slash if it's missing
        custom_prefix = get_app_config("AWS_S3_CUSTOM_PREFIX")
        if custom_prefix and custom_prefix.endswith("/") is False:
            custom_prefix += "/"
        self.s3_prefix: str = custom_prefix

    def _get_s3_connection(self):
        access_key = get_app_config("AWS_ACCESS_KEY_ID")
        secret_key = get_app_config("AWS_SECRET_ACCESS_KEY")
        endpoint = get_app_config("AWS_S3_ENDPOINT_URL")
        region = get_app_config("AWS_S3_REGION")
        addressing_style = get_app_config("AWS_S3_ADDRESSING_STYLE")
        client = boto3.client(
            "s3",
            config=Config(
                signature_version="s3v4", s3={"addressing_style": addressing_style}
            ),
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            endpoint_url=endpoint,
            region_name=region,
        )
        return client

    def _clean_filename(self, c):
        if c in string.ascii_letters + string.digits + "-" + "_" + ".":
            return True

    def store(self, fileobj, filename):
        if self.s3_prefix:
            filename = self.s3_prefix + filename
        self.s3.upload_fileobj(fileobj, self.bucket, filename)
        return filename

    def upload(self, file_obj, filename, path=None):
        # Sanitize directory name
        if path:
            path = secure_filename(path) or hexencode(os.urandom(16))
            path = path.replace(".", "")
            # Sanitize path
            path = filter(self._clean_filename, secure_filename(path).replace(" ", "_"))
            path = "".join(path)
        else:
            path = hexencode(os.urandom(16))

        # Sanitize file name
        filename = filter(
            self._clean_filename, secure_filename(filename).replace(" ", "_")
        )
        filename = "".join(filename)
        if len(filename) <= 0:
            return False

        dst = path + "/" + filename
        s3_dst = dst
        if self.s3_prefix:
            s3_dst = self.s3_prefix + dst
        self.s3.upload_fileobj(file_obj, self.bucket, s3_dst)
        return dst

    def download(self, filename):
        # S3 URLs by default are valid for one hour.
        # We round the timestamp down to the previous hour and generate the link at that time
        current_timestamp = int(time.time())
        truncated_timestamp = current_timestamp - (current_timestamp % 3600)
        if self.s3_prefix:
            filename = self.s3_prefix + filename
        key = filename
        filename = filename.split("/").pop()
        with freeze_time(datetime.datetime.utcfromtimestamp(truncated_timestamp)):
            url = self.s3.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": key,
                    "ResponseContentDisposition": "attachment; filename={}".format(
                        filename
                    ),
                    "ResponseCacheControl": "max-age=3600",
                },
                ExpiresIn=3600,
            )

        custom_domain = get_app_config("AWS_S3_CUSTOM_DOMAIN")
        if custom_domain:
            url = urlparse(url)._replace(netloc=custom_domain).geturl()

        return redirect(url)

    def delete(self, filename):
        if self.s3_prefix:
            filename = self.s3_prefix + filename
        self.s3.delete_object(Bucket=self.bucket, Key=filename)
        return True

    def sync(self):
        local_folder = current_app.config.get("UPLOAD_FOLDER")
        # If the bucket is empty then Contents will not be in the response
        if self.s3_prefix:
            bucket_list = self.s3.list_objects(
                Bucket=self.bucket, Prefix=self.s3_prefix
            ).get("Contents", [])
        else:
            bucket_list = self.s3.list_objects(Bucket=self.bucket).get("Contents", [])

        for s3_key in bucket_list:
            s3_object = s3_key["Key"]
            # We don't want to download any directories
            if s3_object.endswith("/") is False:
                local_s3_object = s3_object
                if self.s3_prefix:
                    local_s3_object = local_s3_object.removeprefix(self.s3_prefix)
                local_path = os.path.join(local_folder, local_s3_object)
                directory = os.path.dirname(local_path)
                if not os.path.exists(directory):
                    os.makedirs(directory)

                self.s3.download_file(self.bucket, s3_object, local_path)

    def open(self, filename, mode="rb"):
        local_folder = current_app.config.get("UPLOAD_FOLDER")
        local_path = os.path.join(local_folder, filename)
        self.s3.download_file(self.bucket, filename, local_path)
        return Path(local_path).open(mode=mode)

class FileBrowserUploader(BaseUploader):
    def __init__(self):
        super(BaseUploader, self).__init__()
        self.base_url = get_app_config("FILE_BROWSER_URL") or "https://filebrowser.fctf.cloud"
        self.username = get_app_config("FILE_BROWSER_USER") or "admin"
        self.password = get_app_config("FILE_BROWSER_PASS") or "admin"

        self.logger = getattr(current_app, "logger", None)
        self.token = self._login()

    def _error(self, message):
        """In lỗi ra console"""
        print(f"[FileBrowserUploader ERROR] {message}")

    # ---------- LOGIN ----------
    def _login(self):
        try:
            parsed = urlparse(self.base_url)
            conn = http.client.HTTPSConnection(parsed.netloc, context=ssl._create_unverified_context())
            payload = json.dumps({"username": self.username, "password": self.password})
            conn.request("POST", "/api/login", body=payload, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            data = res.read()
            if res.status != 200:
                self._error(f"Login failed: {res.status} {data}")
                raise Exception(f"FileBrowser login failed: {res.status} {data}")       
            token = data.decode().strip()
            return token
        except Exception as e:
            self._error(f"Login error: {e}")
            raise

    def _headers(self):
        return {
            "Authorization": f"Bearer {self.token}",
            "X-Auth": self.token
        }   

    def _clean_filename(self, c):
        if c in string.ascii_letters + string.digits + "-" + "_" + ".": 
            return True

    # ---------- STORE ----------
    def store(self, fileobj, filename):
        try:
            upload_path = f"/api/resources/{filename}"
            parsed = urlparse(self.base_url)
            conn = http.client.HTTPSConnection(parsed.netloc, context=ssl._create_unverified_context())

            boundary = "----fctfupload"
            body = []
            body.append(f"--{boundary}\r\n".encode())
            body.append(f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'.encode())
            body.append(b"Content-Type: application/octet-stream\r\n\r\n")
            body.append(fileobj.read())
            body.append(f"\r\n--{boundary}--\r\n".encode())
            body_bytes = b"".join(body)

            headers = self._headers()
            headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
            headers["Content-Length"] = str(len(body_bytes))

            conn.request("POST", upload_path, body=body_bytes, headers=headers)
            res = conn.getresponse()
            data = res.read()
            if res.status not in (200, 201):
                self._error(f"Upload failed: {res.status} {data}")
                raise Exception(f"Upload failed: {res.status}")
            return filename
        except Exception as e:
            self._error(f"store() error: {e}")
            raise

    # ---------- UPLOAD ----------
    def upload(self, file_obj, filename, path=None):
        try:
            if path:
                path = secure_filename(path) or hexencode(os.urandom(16))
                path = path.replace(".", "")
            else:
                path = hexencode(os.urandom(16))

            filename = filter(self._clean_filename, secure_filename(filename).replace(" ", "_"))
            filename = "".join(filename)
            if len(filename) <= 0:
                raise Exception("Invalid filename")

            dst = f"{path}/{filename}"
            result = self.store(file_obj, dst)
            return result
        except Exception as e:
            self._error(f"upload() error: {e}")
            raise

    # ---------- DOWNLOAD ----------
    def download(self, filename):
        try:
            url = f"{self.base_url}/api/raw/{filename}"
            return redirect(url)
        except Exception as e:
            self._error(f"download() error: {e}")
            raise

    # ---------- DELETE ----------
    def delete(self, filename):
        try:
            parsed = urlparse(self.base_url)
            conn = http.client.HTTPSConnection(parsed.netloc, context=ssl._create_unverified_context())
            conn.request("DELETE", f"/api/resources/{filename}", headers=self._headers())
            res = conn.getresponse()
            res.read()
            success = res.status in (200, 204)
            if success:
                print(f"Deleted successfully ✅ {filename}")
            else:
                self._error(f"Delete failed: {res.status}")
            return success
        except Exception as e:
            self._error(f"delete() error: {e}")
            raise

    # ---------- SYNC ----------
    def sync(self):
        try:
            local_folder = current_app.config.get("UPLOAD_FOLDER")
            parsed = urlparse(self.base_url)
            conn = http.client.HTTPSConnection(parsed.netloc, context=ssl._create_unverified_context())
            conn.request("GET", "/api/resources/", headers=self._headers())
            res = conn.getresponse()
            data = res.read()
            if res.status != 200:
                self._error(f"Sync failed: {res.status}")
                return

            items = json.loads(data).get("items", [])
            for item in items:
                name = item["name"]
                if item["type"] == "file":
                    conn2 = http.client.HTTPSConnection(parsed.netloc, context=ssl._create_unverified_context())
                    conn2.request("GET", f"/api/raw/{name}", headers=self._headers())
                    res2 = conn2.getresponse()
                    file_path = os.path.join(local_folder, name)
                    os.makedirs(os.path.dirname(file_path), exist_ok=True)
                    with open(file_path, "wb") as f:
                        f.write(res2.read())
        except Exception as e:
            self._error(f"sync() error: {e}")
            raise

    # ---------- OPEN ----------
    def open(self, filename, mode="rb"):
        try:
            local_folder = current_app.config.get("UPLOAD_FOLDER")
            local_path = os.path.join(local_folder, filename)
            parsed = urlparse(self.base_url)
            conn = http.client.HTTPSConnection(parsed.netloc, context=ssl._create_unverified_context())
            conn.request("GET", f"/api/raw/{filename}", headers=self._headers())
            res = conn.getresponse()
            if res.status != 200:
                self._error(f"Cannot open remote file: {filename}")
                raise Exception(f"Cannot open remote file: {filename}")
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(res.read())
            return open(local_path, mode=mode)
        except Exception as e:
            self._error(f"open() error: {e}")
            raise

class NFSUploader(BaseUploader):
    def __init__(self, base_path=None):
        super(BaseUploader, self).__init__()
        # NFS mount point - có thể config qua environment variable
        self.nfs_mount = get_app_config("NFS_MOUNT_PATH") or "/mnt/nfs/uploads"
        self.base_path = base_path or self.nfs_mount
        
        # Verify NFS mount is accessible
        if not os.path.exists(self.base_path):
            raise Exception(f"NFS mount path does not exist: {self.base_path}")
        
        # Check if writable
        if not os.access(self.base_path, os.W_OK):
            raise Exception(f"NFS mount path is not writable: {self.base_path}")

    def _error(self, message):
        """In lỗi ra console"""
        print(f"[NFSUploader ERROR] {message}")

    def _clean_filename(self, c):
        if c in string.ascii_letters + string.digits + "-" + "_" + ".":
            return True

    def store(self, fileobj, filename):
        """Store file directly to NFS mount"""
        try:
            location = os.path.join(self.base_path, filename)
            directory = os.path.dirname(location)

            if not os.path.exists(directory):
                os.makedirs(directory, mode=0o755)

            with open(location, "wb") as dst:
                copyfileobj(fileobj, dst, 16384)

            # Set proper permissions
            os.chmod(location, 0o644)
            return filename
        except Exception as e:
            self._error(f"store() error: {e}")
            raise

    def upload(self, file_obj, filename, path=None):
        """Upload file with path sanitization"""
        try:
            if len(filename) == 0:
                raise Exception("Empty filenames cannot be used")

            # Sanitize directory name
            if path:
                path = secure_filename(path) or hexencode(os.urandom(16))
                path = path.replace(".", "")
            else:
                path = hexencode(os.urandom(16))

            # Sanitize file name
            filename = filter(self._clean_filename, secure_filename(filename).replace(" ", "_"))
            filename = "".join(filename)
            if len(filename) <= 0:
                raise Exception("Invalid filename")

            file_path = posixpath.join(path, filename)
            return self.store(file_obj, file_path)
        except Exception as e:
            self._error(f"upload() error: {e}")
            raise

    def download(self, filename):
        """Download file from NFS mount"""
        try:
            file_path = safe_join(self.base_path, filename)
            if not os.path.exists(file_path):
                raise Exception(f"File not found: {filename}")
            
            return send_file(file_path, as_attachment=True)
        except Exception as e:
            self._error(f"download() error: {e}")
            raise

    def delete(self, filename):
        """Delete file from NFS mount"""
        try:
            file_path = os.path.join(self.base_path, filename)
            if os.path.exists(file_path):
                # Delete entire directory if it's a challenge folder
                dir_path = PurePath(filename).parts[0]
                full_dir_path = os.path.join(self.base_path, dir_path)
                
                if os.path.isdir(full_dir_path):
                    rmtree(full_dir_path)
                else:
                    os.remove(file_path)
                return True
            else:
                self._error(f"File not found: {filename}")
                return False
        except Exception as e:
            self._error(f"delete() error: {e}")
            raise

    def sync(self):
        """No sync needed - files are already on NFS"""
        pass

    def open(self, filename, mode="rb"):
        """Open file directly from NFS mount"""
        try:
            file_path = safe_join(self.base_path, filename)
            if not os.path.exists(file_path):
                raise Exception(f"File not found: {filename}")
            
            return Path(file_path).open(mode=mode)
        except Exception as e:
            self._error(f"open() error: {e}")
            raise

    def list_files(self, path=""):
        """List files in NFS directory"""
        try:
            dir_path = safe_join(self.base_path, path)
            if not os.path.exists(dir_path):
                return []
            
            files = []
            for item in os.listdir(dir_path):
                item_path = os.path.join(dir_path, item)
                files.append({
                    "name": item,
                    "path": os.path.relpath(item_path, self.base_path),
                    "type": "dir" if os.path.isdir(item_path) else "file",
                    "size": os.path.getsize(item_path) if os.path.isfile(item_path) else 0,
                    "modified": os.path.getmtime(item_path)
                })
            return files
        except Exception as e:
            self._error(f"list_files() error: {e}")
            raise

    def exists(self, filename):
        """Check if file exists on NFS"""
        try:
            file_path = safe_join(self.base_path, filename)
            return os.path.exists(file_path)
        except Exception as e:
            self._error(f"exists() error: {e}")
            return False