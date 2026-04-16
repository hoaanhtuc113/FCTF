Get-ChildItem -Path 'Test\*.ts' | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $newContent = $content `
        -replace 'https://admin\.fctf\.site', 'https://admin0.fctf.site' `
        -replace 'https://contestant\.fctf\.site', 'https://contestant0.fctf.site'
    if ($content -ne $newContent) {
        Set-Content -Path $_.FullName -Value $newContent -NoNewline
        Write-Host "Updated: $($_.Name)"
    }
}
Write-Host "Done."
