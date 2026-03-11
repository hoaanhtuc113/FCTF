# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - navigation [ref=e2]:
    - generic [ref=e3]:
      - link "FCTF" [ref=e4] [cursor=pointer]:
        - /url: /?route=%2F
      - list [ref=e6]:
        - listitem [ref=e7]:
          - link "Admin Panel  Admin Panel" [ref=e8] [cursor=pointer]:
            - /url: /admin
            - generic "Admin Panel": 
            - generic [ref=e9]:
              - generic [ref=e10]: 
              - text: Admin Panel
        - listitem [ref=e11]:
          - link "Logout " [ref=e12] [cursor=pointer]:
            - /url: /logout
            - generic "Logout": 
            - generic [ref=e14]: 
  - main [ref=e15]:
    - generic [ref=e19]:
      - heading "File not found" [level=1] [ref=e20]
      - separator [ref=e21]
      - heading "404 Not Found" [level=2] [ref=e22]
  - contentinfo [ref=e23]:
    - link "FCTF DEV TEAM" [ref=e25] [cursor=pointer]:
      - /url: "#"
```