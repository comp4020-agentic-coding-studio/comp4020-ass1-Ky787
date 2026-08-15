extern int puts(const char *);
extern int printf(const char *, ...);

int main(int argc, char **argv)
{
    unsigned x = (unsigned)argc * 7u + 3u;

    if ((x & 1u) == 0) {
        puts("ACCESS GRANTED");
        x = (x * 3u) ^ 0x42u;
    } else {
        puts("ACCESS DENIED");
        x = (x + 13u) ^ 0x17u;
    }

    if (x > 100u)
        x -= 17u;
    else
        x += 5u;

    printf("result=%u\n", x & 0xffu);
    return 0;
}