#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

void hacked()
{
    system("cat flag.txt");
}

void register_name()
{
    char buffer[16];

    printf("Name:\n");
    fflush(stdout);  // Flush the output buffer after printing the prompt
    scanf("%s", buffer);
    printf("Hi there, %s\n", buffer);    
    fflush(stdout);  // Flush the output buffer after printing the prompt
    hacked();
}

int main()
{
    register_name();

    return 0;
}