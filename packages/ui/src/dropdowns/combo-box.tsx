/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Combobox } from "@headlessui/react";
import type { ElementType, KeyboardEventHandler, ReactNode, Ref } from "react";
import React, { Fragment, forwardRef, useEffect, useRef, useState } from "react";

type Props = {
  as?: ElementType | undefined;
  ref?: Ref<HTMLElement> | undefined;
  tabIndex?: number | undefined;
  className?: string | undefined;
  value?: string | string[] | null;
  onChange?: (value: any) => void;
  disabled?: boolean | undefined;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement> | undefined;
  multiple?: boolean;
  renderByDefault?: boolean;
  button: ReactNode;
  children: ReactNode;
  role?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
};

const ComboDropDown = forwardRef(function ComboDropDown(props: Props, ref) {
  const { button, renderByDefault = true, children, ...rest } = props;

  const dropDownButtonRef = useRef<HTMLDivElement | null>(null);

  const [shouldRender, setShouldRender] = useState(renderByDefault);

  const onHover = () => {
    setShouldRender(true);
  };

  useEffect(() => {
    const element = dropDownButtonRef.current;

    if (!element) return;

    element.addEventListener("mouseenter", onHover);

    return () => {
      element.removeEventListener("mouseenter", onHover);
    };
  }, [dropDownButtonRef, shouldRender]);

  if (!shouldRender) {
    return (
      <div ref={dropDownButtonRef} className="flex h-full items-center">
        {button}
      </div>
    );
  }

  return (
    <Combobox {...(rest as React.ComponentPropsWithoutRef<typeof Combobox>)} ref={ref as React.Ref<HTMLElement>}>
      <Combobox.Button as={Fragment}>{button}</Combobox.Button>
      {children}
    </Combobox>
  );
});

const ComboOptions = Combobox.Options;
const ComboOption = Combobox.Option;
const ComboInput = Combobox.Input;

ComboDropDown.displayName = "ComboDropDown";

export { ComboDropDown, ComboOptions, ComboOption, ComboInput };
