import React from "react";
import Svg, { Path } from "react-native-svg";
import { siNotion, siZoom } from "simple-icons";
import GmailIconSVG from "../assets/icons/gmail.svg";
import SyncedIconSVG from "../assets/icons/synced.svg";

export interface IconProps {
  size?: number;
  color?: string;
  weight?: string;
  style?: any;
}

export const GmailIcon = ({ size = 24, color, style }: IconProps) => {
  return (
    <GmailIconSVG
      width={size}
      height={size}
      style={style}
      color={color}
    />
  );
};

export const SyncedIcon = ({ size = 24, color, style }: IconProps) => {
  return (
    <SyncedIconSVG
      width={size}
      height={size}
      style={style}
      color={color}
    />
  );
};

export const NotionIcon = ({ size = 24, color, style }: IconProps) => {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={style}
    >
      <Path d={siNotion.path} fill={color || `#${siNotion.hex}`} />
    </Svg>
  );
};

export const ZoomIcon = ({ size = 24, color, style }: IconProps) => {
  return (
    <Svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={style}
    >
      <Path d={siZoom.path} fill={color || `#${siZoom.hex}`} />
    </Svg>
  );
};
