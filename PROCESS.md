# Process overview

## What I built

A website that showcases how using various obfuscation methods during compile time for a simple C program for Windows can make it look extremely complex even when the original program was simple. The site includes interactive sliders and a graph view for exploring the obfuscated code and also the original C and assembly with a colour scheme to match. 

## The moments that mattered

### 1. Showing the original and assembly code side by side

Making the model show the actual C and assembly code at the top allows for an easier viewing experience for users not familiar with assembly. For myself and the model who are familiar with assembly it would be easy to forget that the overall idea is actually quite confusing so the model needed to be reminded to show what the site actually meant. I got some friends to critique the site and they said the change made it much easier to understand. 

[`96ec515`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Ky787/commit/96ec515)
[`34b2bde`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Ky787/commit/34b2bde)


### 2. Added small explainers to Hikari switches and confirmed with ground truth

I got a list of build commands along with the source json to feed into claude so it would produce the correct clang build args. This involved getting it to generate a separate Python script to parse my build data to correctly build the jsons. With this, the real CLI build options can be visualised and are sourced from the actual build args instead of getting claude to generate what they probably were since this niche use case would probably result in hallucinations. 

[`ee6c9ea`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Ky787/commit/ee6c9ea)

### 3. Made graph main page attraction

The graph was the main part of the website apart from the original C and assembly, so I removed the older "Watched strings" and "block inspector" parts and just made the graph the entire bottom half of the website in order to give it more space. I told claude to put in the original assembly for all the blocks and always render them as the point was not to get precision with the graph but to grasp the complexity of the overall program. Overall I found a framing of my idea that worked well without breaking the data integrity of the actual code. 

[`e06a9ec`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Ky787/commit/e06a9ec)
[`88187f1`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Ky787/commit/88187f1)

### 4. Added red to green

As the block splitting and compiler optimisations run in contrast to each other, I decided to swap the compiler slider direction (so it starts at O3 instead of O0) so that the user interaction is the same for the sliders. I also added red-green colouring to demonstrate to the user that setting the options made the code harder to read as naturally, red means bad and green means good — which is a concept claude might not originally infer. I set the compiler optimisation at O3 which removes some obfuscations even though it defaults as an on setting since it made more sense from a programmer's view: most programmers enable optimisations, and disabling them allows for greater obfuscation.

[`9f5fc21`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-Ky787/commit/9f5fc21)
