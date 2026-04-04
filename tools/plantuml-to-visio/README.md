# PlantUML to Visio (.vsdx) CLI

CLI nay chay tren Windows de chuyen file PlantUML (`.puml`) thanh file Visio native (`.vsdx`).
Sau khi import, script se ungroup nhieu lop de tach thanh cac shape/co no i co the chon, di chuyen, sua text trong Visio.

## Yeu cau

- Windows
- Microsoft Visio desktop (de dung COM automation)
- Java (JRE/JDK), lenh `java` phai co trong `PATH`
- Quyen PowerShell de chay script

## File script

- `convert-plantuml-to-visio.ps1`

## Cach dung nhanh

```powershell
cd tools/plantuml-to-visio
./convert-plantuml-to-visio.ps1 -InputPath "C:/path/to/diagram.puml"
```

Mac dinh output se la cung thu muc voi input va ten file doi duoi thanh `.vsdx`.

Vi du:

- Input: `C:/work/flow.puml`
- Output: `C:/work/flow.vsdx`

## Tuy chon

```powershell
./convert-plantuml-to-visio.ps1 \
  -InputPath "C:/path/to/diagram.puml" \
  -OutputPath "C:/path/to/output/my-diagram.vsdx" \
  -PlantUmlJar "C:/tools/plantuml.jar"
```

### Tham so

- `-InputPath` (bat buoc): duong dan file `.puml`
- `-OutputPath` (tuy chon): duong dan file `.vsdx` output
- `-PlantUmlJar` (tuy chon): duong dan toi `plantuml.jar`
- `-KeepIntermediate` (tuy chon): giu lai file tam `.svg`

Neu khong truyen `-PlantUmlJar`, script se:

1. Tim `plantuml.jar` trong cung thu muc script.
2. Neu chua co, tu dong tai ban moi nhat tu GitHub release cua PlantUML.

## Luu y

- Script import SVG vao 1 trang Visio, ungroup de thanh cac shape/co noi tuong tac, roi luu thanh `.vsdx`.
- Moi lan chay script se tao 1 file Visio moi.
- Neu gap loi COM, kiem tra Visio da cai dat day du va co the mo binh thuong.
- Day la conversion vector editable, khong phai map 1-1 sang UML stencil native cua Visio.

## Test nhanh

Tao file `sample.puml`:

```text
@startuml
Alice -> Bob: Hello
Bob --> Alice: Hi
@enduml
```

Chay:

```powershell
./convert-plantuml-to-visio.ps1 -InputPath "./sample.puml"
```

Ket qua mong doi: sinh ra `sample.vsdx` trong cung thu muc.
