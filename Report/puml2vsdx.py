import sys
import os
import subprocess
import urllib.request

# Đường dẫn URL để tự tải PlantUML nếu máy chưa có
PLANTUML_URL = "https://github.com/plantuml/plantuml/releases/download/v1.2024.3/plantuml-1.2024.3.jar"
PLANTUML_JAR = "plantuml.jar"

def download_plantuml_if_missing():
    if not os.path.exists(PLANTUML_JAR):
        print(f"[*] Downloading {PLANTUML_JAR} from Official Repo...")
        urllib.request.urlretrieve(PLANTUML_URL, PLANTUML_JAR)
        print("[+] Download complete.")

def convert_puml_to_vdx(puml_file):
    print(f"[*] Step 1: Converting '{puml_file}' to intermediate VDX using PlantUML engine...")
    # Gọi PlantUML với cờ -tvdx
    result = subprocess.run(["java", "-jar", PLANTUML_JAR, "-tvdx", puml_file], capture_output=True, text=True)
    
    if result.returncode != 0:
        print("[-] Error converting PlantUML to VDX:")
        print(result.stderr)
        sys.exit(1)
    
    base_name = os.path.splitext(puml_file)[0]
    expected_vdx = base_name + ".vdx"
    
    if os.path.exists(expected_vdx):
        print(f"[+] Successfully generated intermediate file: {expected_vdx}")
        return expected_vdx
    else:
        print(f"[-] Failed to generate expected VDX file (Check your PlantUML syntax).")
        sys.exit(1)

def convert_vdx_to_vsdx(vdx_file):
    print(f"[*] Step 2: Converting '{vdx_file}' to VSDX using MS Visio Background Automation...")
    try:
        import win32com.client
    except ImportError:
        print("[-] Error: 'pywin32' package missing. Please run 'pip install pywin32'.")
        sys.exit(1)
        
    base_name = os.path.splitext(vdx_file)[0]
    vsdx_file = base_name + ".vsdx"
    vdx_abspath = os.path.abspath(vdx_file)
    vsdx_abspath = os.path.abspath(vsdx_file)

    try:
        # Mở ứng dụng Visio chạy ngầm (không hiển thị UI lên màn hình)
        visio = win32com.client.DispatchEx("Visio.Application")
        visio.Visible = False
        
        # Mở file .vdx
        doc = visio.Documents.Open(vdx_abspath)
        
        # Save As thành .vsdx (Visio tự động nhận diện theo đuôi mở rộng)
        doc.SaveAs(vsdx_abspath)
        doc.Close()
        print(f"[+++] SUCCESS: Final diagram saved at -> {vsdx_abspath}")
        
    except Exception as e:
        print(f"[-] COM Error with MS Visio: {e}")
        print("[-] Make sure Microsoft Visio is installed on this Windows PC and fully activated.")
    finally:
        try:
            visio.Quit()
        except:
            pass

def main():
    if len(sys.argv) != 2:
        print("Usage: python puml2vsdx.py <diagram.puml>")
        sys.exit(1)
        
    puml_file = sys.argv[1]
    if not os.path.exists(puml_file):
        print(f"[-] File not found: {puml_file}")
        sys.exit(1)
        
    download_plantuml_if_missing()
    vdx_file = convert_puml_to_vdx(puml_file)
    convert_vdx_to_vsdx(vdx_file)
    
    # Dọn dẹp file trung gian .vdx cho sạch sẽ folder
    if os.path.exists(vdx_file):
        os.remove(vdx_file)
        print(f"[*] Cleaned up intermediate file.")

if __name__ == "__main__":
    main()
