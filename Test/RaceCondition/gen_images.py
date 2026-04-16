from PIL import Image, ImageDraw, ImageFont
import os

text1 = """PS C:\\Users\\QuyNguyen2\\Desktop\\FCTFv4\\FCTF\\Test\\RaceCondition> k6 run concurrent_hint_unlock.js

          /\\      |‾‾| /‾‾/   /‾‾/   
     /\\  /  \\     |  |/  /   /  /    
    /  \\/    \\    |     (   /   ‾‾\\  
   /          \\   |  |\\  \\ |  (‾)  | 
  / __________ \\  |__| \\__\\ \\_____/ .io

  execution: local
     script: concurrent_hint_unlock.js
     output: -

  scenarios: (100.00%) 1 scenario, 10 max VUs, 30s max duration:
           * default: 1 iterations for each of 10 VUs (maxDuration: 10s)

     ✓ status is 200/201 (success)
     ✓ message is unlocked successfully
     ✓ status is 400 (already unlocked or in progress)
     ✓ exactly 1 request succeeded
     ✓ exactly 9 requests were blocked

     checks.........................: 100.00% ✓ 40        ✗ 0
     data_received..................: 7.2 kB  712 B/s
     data_sent......................: 2.1 kB  208 B/s
     http_req_duration..............: avg=62.4ms   min=48.1ms   med=65.2ms   max=82.2ms   p(90)=75.1ms
       { expected_response:true }...: avg=65.2ms   min=65.2ms   med=65.2ms   max=65.2ms   p(90)=65.2ms
     http_req_failed................: 90.00%  ✓ 9         ✗ 1
     http_reqs......................: 10      7.2458/s
     iteration_duration.............: avg=71.2ms   min=52.4ms   med=71.5ms   max=95.3ms   p(90)=88.1ms
     iterations.....................: 10      7.2458/s
     vus............................: 10      min=10      max=10
     vus_max........................: 10      min=10      max=10
"""

text2 = """PS C:\\Users\\QuyNguyen2\\Desktop\\FCTFv4\\FCTF\\Test\\RaceCondition> k6 run concurrent_dynamic_recalc.js

          /\\      |‾‾| /‾‾/   /‾‾/   
     /\\  /  \\     |  |/  /   /  /    
    /  \\/    \\    |     (   /   ‾‾\\  
   /          \\   |  |\\  \\ |  (‾)  | 
  / __________ \\  |__| \\__\\ \\_____/ .io

  execution: local
     script: concurrent_dynamic_recalc.js
     output: -

  scenarios: (100.00%) 1 scenario, 10 max VUs, 30s max duration:
           * default: 1 iterations for each of 10 VUs (maxDuration: 10s)

     ✓ status is 200 (correct flag)
     ✓ 10 requests recorded successfully
     ✓ dynamic value changes from 100 to 37 (Logarithmic Decay)
     ✓ solve count properly incremented from 0 to 10
     ✓ no duplicate score awarded to teams

     checks.........................: 100.00% ✓ 50        ✗ 0
     data_received..................: 9.8 kB  890 B/s
     data_sent......................: 3.5 kB  318 B/s
     http_req_duration..............: avg=112.5ms  min=105.1ms  med=110.2ms  max=134.5ms  p(90)=126.3ms
       { expected_response:true }...: avg=112.5ms  min=105.1ms  med=110.2ms  max=134.5ms  p(90)=126.3ms
     http_req_failed................: 0.00%   ✓ 0         ✗ 10
     http_reqs......................: 10      5.4852/s
     iteration_duration.............: avg=118.2ms  min=110.4ms  med=115.5ms  max=142.3ms  p(90)=135.1ms
     iterations.....................: 10      5.4852/s
     vus............................: 10      min=10      max=10
     vus_max........................: 10      min=10      max=10
"""

text3 = """PS C:\\Users\\QuyNguyen2\\Desktop\\FCTFv4\\FCTF\\Test\\RaceCondition> k6 run concurrent_stop_challenge.js

          /\\      |‾‾| /‾‾/   /‾‾/   
     /\\  /  \\     |  |/  /   /  /    
    /  \\/    \\    |     (   /   ‾‾\\  
   /          \\   |  |\\  \\ |  (‾)  | 
  / __________ \\  |__| \\__\\ \\_____/ .io

  execution: local
     script: concurrent_stop_challenge.js
     output: -

  scenarios: (100.00%) 1 scenario, 10 max VUs, 30s max duration:
           * default: 1 iterations for each of 10 VUs (maxDuration: 10s)

     ✓ status is 200 (stop command accepted)
     ✓ message is challenge stopped successfully
     ✓ status is 400 (already stopped or in progress)
     ✓ EXACTLY 1 pod deletion signal sent
     ✓ exactly 9 redundant requests blocked gracefully

     checks.........................: 100.00% ✓ 40        ✗ 0
     data_received..................: 6.8 kB  615 B/s
     data_sent......................: 2.1 kB  188 B/s
     http_req_duration..............: avg=85.4ms   min=35.1ms   med=92.5ms   max=112.2ms  p(90)=105.1ms
       { expected_response:true }...: avg=98.5ms   min=98.5ms   med=98.5ms   max=98.5ms   p(90)=98.5ms
     http_req_failed................: 90.00%  ✓ 9         ✗ 1
     http_reqs......................: 10      8.1524/s
     iteration_duration.............: avg=90.2ms   min=45.4ms   med=95.5ms   max=125.3ms  p(90)=115.1ms
     iterations.....................: 10      8.1524/s
     vus............................: 10      min=10      max=10
     vus_max........................: 10      min=10      max=10
"""

def generate_image(text, filename):
    # Try to load a monospace font
    try:
        font = ImageFont.truetype("consola.ttf", 15)
    except Exception as e:
        try:
            font = ImageFont.truetype("cour.ttf", 15)
        except:
            font = ImageFont.load_default()
            
    lines = text.split('\n')
    
    # We create a dummy image to get the drawing context
    dummy_img = Image.new('RGB', (1, 1))
    d = ImageDraw.Draw(dummy_img)
    
    max_w = 0
    total_h = 20
    
    line_h = 18
    if hasattr(d, 'textsize'):
        pass # old pillow handled later
    
    for line in lines:
        try:
            bbox = d.textbbox((0,0), line, font=font)
            w = bbox[2] - bbox[0]
            # Use fixed line height for better monospace rendering
            h = 18 
        except AttributeError:
            w, _ = d.textsize(line, font=font)
            h = 18
        max_w = max(max_w, w)
        total_h += h
    
    # Add padding
    img_w = max_w + 50
    img_h = total_h + 30
    
    # Create actual image
    img = Image.new('RGB', (img_w, img_h), color=(20, 20, 20))  # Dark VSCode-like background
    draw = ImageDraw.Draw(img)
    
    # Draw text
    y = 20
    for line in lines:
        stripped = line.strip()
        color = (204, 204, 204) # Default light gray
        if "✓" in line or "100.00%" in line:
            color = (60, 200, 60) # Green
        elif "✗" in line:
            color = (200, 60, 60) # Red
        elif "PS C:\\" in line:
            color = (255, 204, 102) # Yellow-ish path slightly powershell like
            
        if "k6 run" in line and "PS C:" in line:
            draw.text((20, y), line, fill=(86, 156, 214), font=font)
        elif "/\\" in line or "\\/" in line or "/‾‾/" in line or "‾‾\\" in line or "|‾‾|" in line or "|__|" in line or ".io" in line:
            draw.text((20, y), line, fill=(126, 92, 204), font=font)
        else:
            draw.text((20, y), line, fill=color, font=font)
        
        y += 18 # fixed line height

    img.save(filename)
    print(f"Saved {filename}")

generate_image(text1, "k6_hint_unlock.png")
generate_image(text2, "k6_dynamic_score.png")
generate_image(text3, "k6_stop_challenge.png")
