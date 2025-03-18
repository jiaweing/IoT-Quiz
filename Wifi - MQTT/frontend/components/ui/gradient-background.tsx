"use client";
 
 import React, { HTMLAttributes } from "react";
 import { cn } from "@/lib/utils";
 
interface GradientBackgroundProps extends HTMLAttributes<HTMLDivElement> {
   children: React.ReactNode;
 }
 
 export const GradientBackground: React.FC<GradientBackgroundProps> = ({
   children,
   className,
   ...props
 }) => {
   return (
     <div
       className={cn(
         "min-h-screen w-full flex items-center justify-center bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 animate-gradient-x",
         className
       )}
       {...props}
     >
       {children}
     </div>
   );
 };