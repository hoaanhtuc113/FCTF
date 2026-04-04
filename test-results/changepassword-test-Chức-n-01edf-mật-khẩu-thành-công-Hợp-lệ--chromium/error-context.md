# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e5]:
    - img "logo" [ref=e7]
    - generic [ref=e8]: FPT_CAPTURE_THE_FLAG
  - generic [ref=e9]:
    - generic [ref=e10]: $ ./authenticate
    - generic [ref=e12]:
      - generic [ref=e13]:
        - generic [ref=e14]: "[username]"
        - generic [ref=e16]:
          - textbox "input username..." [ref=e17]: user2
          - group
      - generic [ref=e18]:
        - generic [ref=e19]: "[PASSWORD]"
        - generic [ref=e21]:
          - textbox "enter_password" [ref=e22]: "1"
          - group
      - generic [ref=e23]:
        - button "[CLEAR]" [ref=e24] [cursor=pointer]
        - button "[LOGIN]" [ref=e25] [cursor=pointer]: "[LOGIN]"
    - generic [ref=e27]:
      - generic [ref=e28]: "status: ready"
      - generic [ref=e29]: "endpoint: /auth/login"
      - generic [ref=e30]: "mode: secure"
  - generic [ref=e31]:
    - generic [ref=e32]: FPT_University © 2025
    - generic [ref=e33]: need_access? contact_admin
```